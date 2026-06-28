using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Backend.Data;
using Backend.Models;
using Backend.Services;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class FoodStallsController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly IAudioGenerationPipeline _audioPipeline;
        private readonly IStallMetadataTranslationService _metadataTranslation;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<FoodStallsController> _logger;

        // Supported languages for offline packages
        private static readonly string[] SupportedLanguages = { "vi", "en", "ja", "ko", "zh" };

        public FoodStallsController(
            AppDbContext dbContext,
            IAudioGenerationPipeline audioPipeline,
            IStallMetadataTranslationService metadataTranslation,
            IServiceScopeFactory scopeFactory,
            ILogger<FoodStallsController> logger)
        {
            _dbContext = dbContext;
            _audioPipeline = audioPipeline;
            _metadataTranslation = metadataTranslation;
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        // 1. Synchronize Endpoint for Mobile Clients
        // Returns cached localizations immediately; missing translations are generated in background.
        [HttpGet("sync")]
        public async Task<IActionResult> Sync([FromQuery] string lang = "en")
        {
            lang = lang.Trim().ToLower();
            if (!SupportedLanguages.Contains(lang))
            {
                lang = "en";
            }

            var stalls = await _dbContext.FoodStalls.AsNoTracking().Where(s => s.IsActive).ToListAsync();
            var stallIds = stalls.Select(s => s.Id).ToList();

            var localizations = await _dbContext.Localizations
                .AsNoTracking()
                .Where(l => l.LanguageCode == lang && stallIds.Contains(l.FoodStallId))
                .ToListAsync();

            var localizationByStall = localizations.ToDictionary(l => l.FoodStallId);
            var result = new List<object>();
            var missingStallIds = new List<Guid>();

            foreach (var stall in stalls)
            {
                string translatedText;
                string audioUrl;

                var currentHash = ComputeMd5Hash(stall.OriginalHistory ?? string.Empty);

                if (lang == "vi")
                {
                    translatedText = stall.OriginalHistory;
                    var hasViLoc = localizationByStall.TryGetValue(stall.Id, out var viLoc);
                    var isOutdated = hasViLoc && viLoc.TextHash != currentHash;
                    
                    audioUrl = hasViLoc && !isOutdated && !string.IsNullOrEmpty(viLoc.AudioUrl)
                        ? $"{viLoc.AudioUrl}?v={viLoc.TextHash ?? Guid.NewGuid().ToString("N")}"
                        : string.Empty;

                    if (!hasViLoc || isOutdated)
                    {
                        missingStallIds.Add(stall.Id);
                    }
                }
                else
                {
                    var hasLoc = localizationByStall.TryGetValue(stall.Id, out var cachedLoc);
                    var isOutdated = hasLoc && cachedLoc.TextHash != currentHash;

                    if (hasLoc && !isOutdated && !string.IsNullOrWhiteSpace(cachedLoc.TranslatedText))
                    {
                        translatedText = cachedLoc.TranslatedText;
                        audioUrl = !string.IsNullOrEmpty(cachedLoc.AudioUrl)
                            ? $"{cachedLoc.AudioUrl}?v={cachedLoc.TextHash ?? Guid.NewGuid().ToString("N")}"
                            : string.Empty;
                    }
                    else
                    {
                        translatedText = string.Empty;
                        audioUrl = string.Empty;
                        missingStallIds.Add(stall.Id);
                    }
                }

                var metadata = _metadataTranslation.GetCached(stall.Id, stall.Name, stall.Address, lang);

                result.Add(new
                {
                    stall.Id,
                    stall.Name,
                    stall.Address,
                    stall.Latitude,
                    stall.Longitude,
                    stall.OriginalHistory,
                    Translation = new
                    {
                        translatedText,
                        audioUrl,
                        translatedName = metadata.Name,
                        translatedAddress = metadata.Address
                    }
                });
            }

            if (missingStallIds.Count > 0)
            {
                _ = Task.Run(() => GenerateMissingLocalizationsInBackgroundAsync(missingStallIds, lang));
            }

            return Ok(new
            {
                stalls = result,
                pendingTranslations = missingStallIds.Count
            });
        }

        private async Task GenerateMissingLocalizationsInBackgroundAsync(List<Guid> stallIds, string lang)
        {
            _logger.LogInformation("Background translation started for {Count} stalls in language {Lang}", stallIds.Count, lang);

            foreach (var stallId in stallIds)
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var pipeline = scope.ServiceProvider.GetRequiredService<IAudioGenerationPipeline>();
                    var metadataTranslation = scope.ServiceProvider.GetRequiredService<IStallMetadataTranslationService>();
                    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                    await pipeline.ProcessStallLocalizationAsync(stallId, lang);

                    var stall = await dbContext.FoodStalls.AsNoTracking()
                        .FirstOrDefaultAsync(s => s.Id == stallId);
                    if (stall != null)
                    {
                        await metadataTranslation.WarmCacheAsync(stallId, stall.Name, stall.Address, lang);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Background localization failed for stall {StallId} lang {Lang}", stallId, lang);
                }

                await Task.Delay(4500);
            }

            _logger.LogInformation("Background translation finished for language {Lang}", lang);
        }

        // 2. GET All (Admin/Web view)
        [HttpGet]
        public async Task<ActionResult<IEnumerable<FoodStall>>> GetFoodStalls()
        {
            return await _dbContext.FoodStalls.ToListAsync();
        }

        // 3. GET Single Stall
        [HttpGet("{id}")]
        public async Task<ActionResult<FoodStall>> GetFoodStall(Guid id)
        {
            var foodStall = await _dbContext.FoodStalls.FindAsync(id);
            if (foodStall == null) return NotFound();
            return foodStall;
        }

        // 4. POST Create Stall (Triggers Audio Generation Pipeline)
        [HttpPost]
        public async Task<ActionResult<FoodStall>> PostFoodStall(FoodStall stall)
        {
            if (stall.Id == Guid.Empty) stall.Id = Guid.NewGuid();

            _dbContext.FoodStalls.Add(stall);
            await _dbContext.SaveChangesAsync();

            // Pre-generate audio for all supported languages in the background
            // so they are ready immediately for offline downloads
            _ = Task.Run(async () =>
            {
                foreach (var lang in SupportedLanguages)
                {
                    try
                    {
                        using (var scope = _scopeFactory.CreateScope())
                        {
                            var pipeline = scope.ServiceProvider.GetRequiredService<IAudioGenerationPipeline>();
                            await pipeline.ProcessStallLocalizationAsync(stall.Id, lang);
                        }
                    }
                    catch (Exception)
                    {
                        // Log and ignore to prevent background thread crash
                    }
                }
            });

            return CreatedAtAction(nameof(GetFoodStall), new { id = stall.Id }, stall);
        }

        // 5. PUT Update Stall
        [HttpPut("{id}")]
        public async Task<IActionResult> PutFoodStall(Guid id, FoodStall stall)
        {
            if (id != stall.Id) return BadRequest();

            _dbContext.Entry(stall).State = EntityState.Modified;

            try
            {
                await _dbContext.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                if (!FoodStallExists(id)) return NotFound();
                throw;
            }

            // Regenerate translation/audio since history/info might have changed
            _ = Task.Run(async () =>
            {
                foreach (var lang in SupportedLanguages)
                {
                    try
                    {
                        using (var scope = _scopeFactory.CreateScope())
                        {
                            var pipeline = scope.ServiceProvider.GetRequiredService<IAudioGenerationPipeline>();
                            await pipeline.ProcessStallLocalizationAsync(stall.Id, lang);
                        }
                    }
                    catch (Exception)
                    {
                        // Log and ignore
                    }
                }
            });

            return NoContent();
        }

        // 6. DELETE Stall
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteFoodStall(Guid id)
        {
            var foodStall = await _dbContext.FoodStalls.FindAsync(id);
            if (foodStall == null) return NotFound();

            // Delete associated localizations
            var localizations = await _dbContext.Localizations.Where(l => l.FoodStallId == id).ToListAsync();
            _dbContext.Localizations.RemoveRange(localizations);

            _dbContext.FoodStalls.Remove(foodStall);
            await _dbContext.SaveChangesAsync();

            return NoContent();
        }

        private bool FoodStallExists(Guid id)
        {
            return _dbContext.FoodStalls.Any(e => e.Id == id);
        }

        private string ComputeMd5Hash(string input)
        {
            if (string.IsNullOrEmpty(input)) return string.Empty;
            byte[] inputBytes = System.Text.Encoding.UTF8.GetBytes(input);
            byte[] hashBytes = System.Security.Cryptography.MD5.HashData(inputBytes);

            var sb = new System.Text.StringBuilder();
            foreach (var b in hashBytes)
            {
                sb.Append(b.ToString("x2"));
            }
            return sb.ToString();
        }
    }
}
