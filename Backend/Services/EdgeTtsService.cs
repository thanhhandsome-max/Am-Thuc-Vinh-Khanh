using System;
using System.IO;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Backend.Services
{
    public interface IEdgeTtsService
    {
        Task<byte[]> SynthesizeAsync(string text, string languageCode);
    }

    public class EdgeTtsService : IEdgeTtsService
    {
        private readonly ILogger<EdgeTtsService> _logger;
        private const string TrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

        public EdgeTtsService(ILogger<EdgeTtsService> logger)
        {
            _logger = logger;
        }

        public async Task<byte[]> SynthesizeAsync(string text, string languageCode)
        {
            if (string.IsNullOrWhiteSpace(text))
                return Array.Empty<byte>();

            var connectionId = Guid.NewGuid().ToString("N").ToLower();
            var token = GenerateSecMsGecToken();
            var version = "1-143.0.3650.75";
            
            // Pass GEC token both in query parameters AND in request headers to be robust
            var wsUrl = $"wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken={TrustedClientToken}&ConnectionId={connectionId}&Sec-MS-GEC={token}&Sec-MS-GEC-Version={version}";
            
            using var client = new ClientWebSocket();
            client.Options.SetRequestHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0");
            client.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
            client.Options.SetRequestHeader("Sec-MS-GEC", token);
            client.Options.SetRequestHeader("Sec-MS-GEC-Version", version);
            client.Options.SetRequestHeader("Pragma", "no-cache");
            client.Options.SetRequestHeader("Cache-Control", "no-cache");

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

            try
            {
                await client.ConnectAsync(new Uri(wsUrl), cts.Token);
                _logger.LogInformation("Connected to Microsoft Edge TTS WebSocket.");

                var requestId = Guid.NewGuid().ToString("N").ToLower();
                var timestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

                // 1. Send Config Message
                var configPayload = "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";
                var configMsg = $"X-RequestId:{requestId}\r\nContent-Type:application/json; charset=utf-8\r\nX-Timestamp:{timestamp}\r\nPath:speech.config\r\n\r\n{configPayload}";
                await client.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(configMsg)), WebSocketMessageType.Text, true, cts.Token);

                // 2. Send SSML Message
                var voice = GetVoiceForLanguage(languageCode);
                var locale = GetLocaleForLanguage(languageCode);
                var escapedText = EscapeXml(text);
                var ssml = $"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{locale}'><voice name='{voice}'>{escapedText}</voice></speak>";
                var ssmlMsg = $"X-RequestId:{requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{timestamp}\r\nPath:ssml\r\n\r\n{ssml}";
                await client.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(ssmlMsg)), WebSocketMessageType.Text, true, cts.Token);

                // 3. Receive Loop
                using var outputStream = new MemoryStream();
                var buffer = new byte[8192];
                var frameBuffer = new MemoryStream();

                while (client.State == WebSocketState.Open && !cts.Token.IsCancellationRequested)
                {
                    var result = await client.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        _logger.LogWarning("WebSocket closed by server. Status: {Status}, Description: {Desc}", 
                            result.CloseStatus, result.CloseStatusDescription);
                        break;
                    }

                    frameBuffer.Write(buffer, 0, result.Count);

                    if (result.EndOfMessage)
                    {
                        var frameBytes = frameBuffer.ToArray();
                        frameBuffer.SetLength(0); // Reset for next message

                        if (result.MessageType == WebSocketMessageType.Text)
                        {
                            var textMsg = Encoding.UTF8.GetString(frameBytes);
                            _logger.LogInformation("Received WS text: {Msg}", textMsg);

                            if (textMsg.Contains("turn.end"))
                            {
                                _logger.LogInformation("Speech synthesis completed by server.");
                                break;
                            }
                        }
                        else if (result.MessageType == WebSocketMessageType.Binary)
                        {
                            // Binary structure:
                            // byte 0 & 1: Big-endian header length
                            // next bytes: headers
                            // remaining bytes: audio payload
                            if (frameBytes.Length > 2)
                            {
                                int headerLength = (frameBytes[0] << 8) | frameBytes[1];
                                if (headerLength + 2 <= frameBytes.Length)
                                {
                                    // Extract raw audio data
                                    var audioOffset = 2 + headerLength;
                                    var audioLength = frameBytes.Length - audioOffset;
                                    _logger.LogInformation("Received audio binary frame: {Length} bytes", audioLength);
                                    outputStream.Write(frameBytes, audioOffset, audioLength);
                                }
                            }
                        }
                    }
                }

                try
                {
                    if (client.State == WebSocketState.Open)
                    {
                        await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "Completed", CancellationToken.None);
                    }
                }
                catch (Exception)
                {
                    // Ignore socket closing exceptions since we have already received all the audio data
                }
                return outputStream.ToArray();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during Edge-TTS synthesis");
                throw;
            }
        }

        private string GenerateSecMsGecToken()
        {
            // DateTimeOffset.UtcNow.ToFileTime() returns Windows File Time (ticks since Jan 1, 1601 UTC)
            long fileTimeTicks = DateTimeOffset.UtcNow.ToFileTime();
            
            // Round down to the nearest 5-minute (300 seconds) interval in ticks
            // 300 seconds = 3,000,000,000 100-nanosecond ticks
            long roundedTicks = (fileTimeTicks / 3000000000L) * 3000000000L;

            string input = roundedTicks.ToString() + TrustedClientToken;
            byte[] inputBytes = Encoding.ASCII.GetBytes(input);

            using var sha256 = SHA256.Create();
            byte[] hash = sha256.ComputeHash(inputBytes);

            var sb = new StringBuilder();
            foreach (byte b in hash)
            {
                sb.Append(b.ToString("X2"));
            }
            return sb.ToString().ToUpper();
        }

        private string GetVoiceForLanguage(string lang)
        {
            return lang.ToLower() switch
            {
                "vi" => "vi-VN-HoaiMyNeural",
                "en" => "en-US-AvaMultilingualNeural",
                "ja" => "ja-JP-NanamiNeural",
                "ko" => "ko-KR-SunHiNeural",
                "zh" => "zh-CN-XiaoxiaoNeural",
                "fr" => "fr-FR-DeniseNeural",
                _ => "en-US-AvaMultilingualNeural"
            };
        }

        private string GetLocaleForLanguage(string lang)
        {
            return lang.ToLower() switch
            {
                "vi" => "vi-VN",
                "en" => "en-US",
                "ja" => "ja-JP",
                "ko" => "ko-KR",
                "zh" => "zh-CN",
                "fr" => "fr-FR",
                _ => "en-US"
            };
        }

        private string EscapeXml(string text)
        {
            if (string.IsNullOrEmpty(text)) return string.Empty;
            return text.Replace("&", "&amp;")
                       .Replace("<", "&lt;")
                       .Replace(">", "&gt;")
                       .Replace("\"", "&quot;")
                       .Replace("'", "&apos;");
        }
    }
}
