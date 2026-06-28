using System;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Backend.Data;
using Backend.Models;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ChatController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly ILogger<ChatController> _logger;

        public ChatController(
            AppDbContext dbContext,
            HttpClient httpClient,
            IConfiguration configuration,
            ILogger<ChatController> logger)
        {
            _dbContext = dbContext;
            _httpClient = httpClient;
            _logger = logger;
            _apiKey = configuration["Gemini:ApiKey"] ?? string.Empty;
        }

        public class ChatRequest
        {
            public string DeviceUniqueId { get; set; } = string.Empty;
            public string Question { get; set; } = string.Empty;
            public double? Latitude { get; set; }
            public double? Longitude { get; set; }
            public string LanguageCode { get; set; } = "vi";
        }

        [HttpPost("ask")]
        public async Task<IActionResult> Ask([FromBody] ChatRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Question))
                return BadRequest("Question cannot be empty.");

            // 1. Record User Activity Telemetry (for future Web Admin tracking)
            var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.DeviceUniqueId == request.DeviceUniqueId);
            if (user == null)
            {
                user = new User
                {
                    Id = Guid.NewGuid(),
                    DeviceUniqueId = request.DeviceUniqueId,
                    LastActive = DateTime.UtcNow
                };
                _dbContext.Users.Add(user);
            }
            else
            {
                user.LastActive = DateTime.UtcNow;
                _dbContext.Entry(user).State = EntityState.Modified;
            }

            var telemetry = new UserTelemetry
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Timestamp = DateTime.UtcNow,
                Latitude = request.Latitude ?? 0,
                Longitude = request.Longitude ?? 0,
                Action = $"CHAT_AI: {request.Question.Take(50)}..."
            };
            _dbContext.UserTelemetries.Add(telemetry);
            await _dbContext.SaveChangesAsync();

            // 2. Load context (all registered stalls on Vĩnh Khánh street, District 4)
            var stalls = await _dbContext.FoodStalls.ToListAsync();
            var contextBuilder = new StringBuilder();
            contextBuilder.AppendLine("Here is the list of registered street food stalls in Vĩnh Khánh, District 4, HCMC:");
            foreach (var stall in stalls)
            {
                contextBuilder.AppendLine($"- Name: {stall.Name}, Address: {stall.Address}, Location: (Lat: {stall.Latitude}, Lon: {stall.Longitude}), Description: {stall.OriginalHistory}");
            }

            // 3. Construct LLM prompt
            var langCode = (request.LanguageCode ?? "vi").Trim().ToLower();
            var replyLanguage = langCode switch
            {
                "en" => "English",
                "ja" => "Japanese",
                "ko" => "Korean",
                "zh" => "Chinese (Simplified)",
                _ => "Vietnamese"
            };

            var systemPrompt = "You are an AI Food Tour Guide for Vĩnh Khánh Street Food Court in District 4, Ho Chi Minh City. " +
                               "Answer the user's questions about the food stalls using ONLY the provided list. " +
                               "If the user asks for a food tour itinerary, create a logical walking route based on their location or coordinate proximities. " +
                               $"CRITICAL INSTRUCTION: You MUST translate any provided context and reply ENTIRELY in {replyLanguage}. If the context is in Vietnamese, translate it to {replyLanguage} before responding. Keep the tone friendly, enthusiastic, and helpful for tourists.";

            var prompt = $"{systemPrompt}\n\nContext:\n{contextBuilder}\n\nUser Question:\n{request.Question}";

            if (string.IsNullOrWhiteSpace(_apiKey))
            {
                return Ok(new
                {
                    Answer = "Xin lỗi, hệ thống AI đang bảo trì (thiếu API Key). Dưới đây là danh sách quán ăn để bạn tham khảo:\n" + 
                             string.Join("\n", stalls.Select(s => $"- {s.Name}: {s.Address}"))
                });
            }

            string[] models = { "gemini-2.5-flash", "gemini-2.0-flash" };
            string answer = string.Empty;
            bool success = false;
            string lastError = "Không thể kết nối đến máy chủ AI.";

            foreach (var model in models)
            {
                var requestUrl = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={_apiKey}";
                int maxRetries = 2;
                int delayMs = 1000;

                for (int attempt = 0; attempt <= maxRetries; attempt++)
                {
                    try
                    {
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

                        using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
                        {
                            var response = await _httpClient.PostAsync(requestUrl, content, cts.Token);
                            
                            if ((int)response.StatusCode == 429 || (int)response.StatusCode == 503)
                            {
                                if (attempt < maxRetries)
                                {
                                    _logger.LogWarning($"Chat Gemini API returned {(int)response.StatusCode} for model {model}. Retrying in {delayMs}ms... (Attempt {attempt + 1}/{maxRetries + 1})");
                                    await Task.Delay(delayMs, cts.Token);
                                    delayMs *= 2;
                                    continue;
                                }
                            }

                            response.EnsureSuccessStatusCode();

                            var jsonResponse = await response.Content.ReadAsStringAsync(cts.Token);
                            using var doc = JsonDocument.Parse(jsonResponse);
                            var root = doc.RootElement;

                            if (root.TryGetProperty("candidates", out var candidates) && 
                                candidates.GetArrayLength() > 0 &&
                                candidates[0].TryGetProperty("content", out var candidateContent) &&
                                candidateContent.TryGetProperty("parts", out var parts) &&
                                parts.GetArrayLength() > 0)
                            {
                                answer = parts[0].GetProperty("text").GetString()?.Trim() ?? string.Empty;
                            }

                            if (!string.IsNullOrEmpty(answer))
                            {
                                success = true;
                                break;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        lastError = ex.Message;
                        _logger.LogWarning(ex, $"Chat error using model {model} (attempt {attempt + 1}).");
                        if (attempt < maxRetries)
                        {
                            await Task.Delay(delayMs);
                            delayMs *= 2;
                        }
                    }
                }

                if (success) break;
            }

            if (!success)
            {
                _logger.LogWarning($"Chat AI API call failed completely: {lastError}. Falling back to list response.");
                var stallListText = string.Join("\n", stalls.Select(s => $"📍 **{s.Name}** ({s.Address}): {s.OriginalHistory}"));
                answer = $"🤖 *[Chế độ dự phòng do Google API quá tải/giới hạn 429]*\n\nXin lỗi bạn, kết nối đến trí tuệ nhân tạo Gemini đang tạm thời gián đoạn. Tuy nhiên, tôi vẫn tìm thấy danh sách các quán ăn đặc sắc trên đường Vĩnh Khánh cho bạn đây:\n\n{stallListText}";
            }

            return Ok(new { Answer = answer });
        }
    }
}
