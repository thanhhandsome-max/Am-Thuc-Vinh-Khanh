using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Backend.Services
{
    public interface IStallMetadataTranslationService
    {
        (string Name, string Address) GetCached(Guid stallId, string name, string address, string languageCode);
        Task WarmCacheAsync(Guid stallId, string name, string address, string languageCode);
    }

    public class StallMetadataTranslationService : IStallMetadataTranslationService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<StallMetadataTranslationService> _logger;
        private readonly ConcurrentDictionary<string, (string Name, string Address)> _cache = new();

        public StallMetadataTranslationService(
            IServiceScopeFactory scopeFactory,
            ILogger<StallMetadataTranslationService> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        public (string Name, string Address) GetCached(Guid stallId, string name, string address, string languageCode)
        {
            if (languageCode.Equals("vi", StringComparison.OrdinalIgnoreCase))
            {
                return (name, address);
            }

            var key = BuildKey(stallId, languageCode);
            return _cache.TryGetValue(key, out var cached) ? cached : (name, address);
        }

        public async Task WarmCacheAsync(Guid stallId, string name, string address, string languageCode)
        {
            if (languageCode.Equals("vi", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var key = BuildKey(stallId, languageCode);
            if (_cache.ContainsKey(key))
            {
                return;
            }

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var translationService = scope.ServiceProvider.GetRequiredService<ITranslationService>();

                var translatedName = await translationService.TranslateAsync(name, languageCode);
                var translatedAddress = await translationService.TranslateAsync(address, languageCode);

                _cache[key] = (
                    string.IsNullOrWhiteSpace(translatedName) ? name : translatedName.Trim(),
                    string.IsNullOrWhiteSpace(translatedAddress) ? address : translatedAddress.Trim()
                );
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to warm metadata translation cache for stall {StallId} lang {Lang}", stallId, languageCode);
            }
        }

        private static string BuildKey(Guid stallId, string languageCode)
        {
            return $"{stallId:N}:{languageCode.ToLowerInvariant()}";
        }
    }
}
