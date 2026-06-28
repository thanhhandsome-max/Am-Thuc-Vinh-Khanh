using System;
using System.Globalization;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Backend.Services
{
    public interface ITranslationService
    {
        Task<string> TranslateAsync(string text, string targetLanguageCode);
    }

    public class TranslationService : ITranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly IConfiguration _configuration;
        private readonly ILogger<TranslationService> _logger;

        public TranslationService(HttpClient httpClient, IConfiguration configuration, ILogger<TranslationService> logger)
        {
            _httpClient = httpClient;
            _configuration = configuration;
            _logger = logger;
        }

        public async Task<string> TranslateAsync(string text, string targetLanguageCode)
        {
            if (string.IsNullOrWhiteSpace(text))
                return string.Empty;

            var provider = _configuration["Translation:Provider"] ?? "Gemini";
            _logger.LogInformation("Using translation provider: {Provider} for language: {Lang}", provider, targetLanguageCode);

            if (targetLanguageCode.Equals("vi", StringComparison.OrdinalIgnoreCase))
            {
                return text;
            }

            if (provider.Equals("DeepL", StringComparison.OrdinalIgnoreCase))
            {
                return await TranslateWithDeepLAsync(text, targetLanguageCode);
            }
            else
            {
                return await TranslateWithGeminiAsync(text, targetLanguageCode);
            }
        }

        private async Task<string> TranslateWithDeepLAsync(string text, string targetLanguageCode)
        {
            var apiKey = _configuration["DeepL:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey) || apiKey.Contains("YOUR_DEEPL_API_KEY"))
            {
                _logger.LogWarning("DeepL API Key is missing or placeholder. Returning empty translation for non-Vietnamese target language.");
                return string.Empty;
            }

            // Map target language code for DeepL (expects uppercase)
            string targetLang = targetLanguageCode.ToUpper() switch
            {
                "EN" => "EN-US",
                "JA" => "JA",
                "KO" => "KO",
                "ZH" => "ZH",
                "FR" => "FR",
                _ => targetLanguageCode.ToUpper()
            };

            try
            {
                var isPro = _configuration.GetValue<bool>("DeepL:IsPro");
                var baseUrl = isPro ? "https://api.deepl.com" : "https://api-free.deepl.com";
                var requestUrl = $"{baseUrl}/v2/translate";

                using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl);
                request.Headers.Add("Authorization", $"DeepL-Auth-Key {apiKey}");
                
                var requestBody = new
                {
                    text = new[] { text },
                    target_lang = targetLang
                };

                var jsonRequest = JsonSerializer.Serialize(requestBody);
                request.Content = new StringContent(jsonRequest, Encoding.UTF8, "application/json");

                var response = await _httpClient.SendAsync(request);
                response.EnsureSuccessStatusCode();

                var jsonResponse = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(jsonResponse);
                var root = doc.RootElement;
                if (root.TryGetProperty("translations", out var translations) && 
                    translations.GetArrayLength() > 0)
                {
                    var translatedText = translations[0].GetProperty("text").GetString()?.Trim();
                    return translatedText ?? string.Empty;
                }

                _logger.LogWarning("Unexpected response format from DeepL. Response: {Response}", jsonResponse);
                return string.Empty;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred during DeepL translation to {Lang}", targetLang);
                return string.Empty;
            }
        }

        private async Task<string> TranslateWithGeminiAsync(string text, string targetLanguageCode)
        {
            var apiKey = _configuration["Gemini:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey) || apiKey.Contains("YOUR_GEMINI_API_KEY"))
            {
                _logger.LogWarning("Gemini API Key is missing or placeholder. Returning empty translation for non-Vietnamese target language.");
                return string.Empty;
            }

            string languageName = targetLanguageCode.ToLower() switch
            {
                "en" => "English",
                "ja" => "Japanese",
                "ko" => "Korean",
                "zh" => "Chinese (Simplified)",
                "fr" => "French",
                _ => targetLanguageCode
            };

            int maxRetries = 3;
            int delayMs = 2000;
            string lastResponseText = null;
            string normalizedText = text?.Trim() ?? string.Empty;
            bool forceTranslate = false;

            for (int attempt = 0; attempt < maxRetries; attempt++)
            {
                try
                {
                    await GeminiRateLimiter.WaitForTurnAsync();

                    var requestUrl = $"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={apiKey}";

                    var prompt = $"You are a professional travel and food translator. Translate the following Vietnamese text about street food stalls into {languageName}. " +
                                 "If the text is still in Vietnamese, translate it fully into the target language. " +
                                 "Preserve proper nouns and dish names, but do NOT keep Vietnamese descriptive text unchanged. " +
                                 "Do not mix Vietnamese prose into the answer. If you must keep proper nouns, keep only the name itself, not the surrounding Vietnamese sentence. " +
                                 "Return ONLY the translated text in the target language without any introduction, explanation, or markdown formatting.\n\nText to translate:\n" + normalizedText;

                    if (forceTranslate)
                    {
                        prompt = $"You are a professional travel and food translator. THIS IS A SECOND ATTEMPT. Translate the following Vietnamese text into {languageName} and do NOT return the original Vietnamese text under any circumstances. " +
                                 "Only return the final translated text. Do not include Vietnamese sentences, notes, or explanations.\n\nText to translate:\n" + normalizedText;
                    }

                    var requestBody = new
                    {
                        contents = new[]
                        {
                            new
                            {
                                parts = new[]
                                {
                                    new { text = prompt }
                                }
                            }
                        }
                    };

                    var jsonRequest = JsonSerializer.Serialize(requestBody);
                    var content = new StringContent(jsonRequest, Encoding.UTF8, "application/json");

                    var response = await _httpClient.PostAsync(requestUrl, content);

                    if ((int)response.StatusCode == 429)
                    {
                        var retryDelay = GetRetryAfterDelayMs(response, delayMs);
                        _logger.LogWarning("Gemini API returned 429 (Too Many Requests). Retrying in {Delay}ms... (Attempt {Attempt}/{Max})", retryDelay, attempt + 1, maxRetries);
                        await Task.Delay(retryDelay);
                        delayMs = Math.Min(retryDelay * 2, 30000);
                        forceTranslate = true;
                        continue;
                    }

                    response.EnsureSuccessStatusCode();

                    var jsonResponse = await response.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(jsonResponse);

                    var root = doc.RootElement;
                    string translatedText = null;

                    if (root.TryGetProperty("candidates", out var candidates) &&
                        candidates.GetArrayLength() > 0 &&
                        candidates[0].TryGetProperty("content", out var candidateContent) &&
                        candidateContent.TryGetProperty("parts", out var parts) &&
                        parts.GetArrayLength() > 0)
                    {
                        translatedText = parts[0].GetProperty("text").GetString()?.Trim();
                    }
                    else if (root.TryGetProperty("output", out var output) &&
                             output.GetArrayLength() > 0 &&
                             output[0].TryGetProperty("content", out var outputContent) &&
                             outputContent.TryGetProperty("text", out var outputText))
                    {
                        translatedText = outputText.GetString()?.Trim();
                    }

                    if (!string.IsNullOrWhiteSpace(translatedText) &&
                        !LooksLikeUntranslatedVietnamese(text, translatedText, targetLanguageCode))
                    {
                        return translatedText;
                    }

                    _logger.LogWarning("Gemini returned untranslated or invalid result for language {Lang}. Response: {Response}", targetLanguageCode, jsonResponse);
                    await Task.Delay(delayMs);
                    delayMs *= 2;
                }
                catch (Exception ex)
                {
                    if (attempt == maxRetries - 1)
                    {
                        _logger.LogError(ex, "Error occurred during Gemini translation to {Lang} after all retries.", targetLanguageCode);
                        return string.Empty;
                    }

                    _logger.LogWarning(ex, "Error during Gemini translation (Attempt {Attempt}/{Max}). Retrying in {Delay}ms...", attempt + 1, maxRetries, delayMs);
                    await Task.Delay(delayMs);
                    delayMs *= 2;
                }
            }

            if (IsDeepLConfigured())
            {
                _logger.LogWarning("Gemini translation failed after {MaxRetries} attempts. Falling back to DeepL for {Lang}.", maxRetries, targetLanguageCode);
                return await TranslateWithDeepLAsync(text, targetLanguageCode);
            }

            return string.Empty;
        }

        private bool IsDeepLConfigured()
        {
            var deepLKey = _configuration["DeepL:ApiKey"];
            return !string.IsNullOrWhiteSpace(deepLKey) && !deepLKey.Contains("YOUR_DEEPL_API_KEY", StringComparison.OrdinalIgnoreCase);
        }

        private int GetRetryAfterDelayMs(HttpResponseMessage response, int defaultDelayMs)
        {
            if (response.Headers.TryGetValues("Retry-After", out var values))
            {
                var retryValue = values.FirstOrDefault();
                if (int.TryParse(retryValue, out var seconds))
                {
                    return Math.Max(seconds * 1000, defaultDelayMs);
                }
            }

            return defaultDelayMs;
        }

        private bool LooksLikeUntranslatedVietnamese(string sourceText, string translatedText, string targetLanguageCode)
        {
            if (string.IsNullOrWhiteSpace(translatedText))
            {
                return true;
            }

            if (targetLanguageCode.Equals("vi", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var sourceNormalized = NormalizeForComparison(sourceText);
            var translatedNormalized = NormalizeForComparison(translatedText);

            if (string.IsNullOrWhiteSpace(sourceNormalized) || string.IsNullOrWhiteSpace(translatedNormalized))
            {
                return false;
            }

            if (string.Equals(sourceNormalized, translatedNormalized, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (translatedNormalized.Contains(sourceNormalized, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return false;
        }

        private string NormalizeForComparison(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
            {
                return string.Empty;
            }

            var normalized = input.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder(normalized.Length);

            foreach (var ch in normalized)
            {
                var category = CharUnicodeInfo.GetUnicodeCategory(ch);
                if (category == UnicodeCategory.NonSpacingMark)
                {
                    continue;
                }

                if (char.IsLetterOrDigit(ch))
                {
                    sb.Append(ch == 'đ' ? 'd' : ch);
                }
            }

            return sb.ToString();
        }
    }
}
