using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Backend.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/foodstalls/{foodStallId:guid}/menu")]
    public class MenuController : ControllerBase
    {
        private readonly AppDbContext _dbContext;

        public MenuController(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<string>>> GetMenuImages(Guid foodStallId)
        {
            var stallExists = await _dbContext.FoodStalls.AnyAsync(s => s.Id == foodStallId);
            if (!stallExists)
            {
                return NotFound();
            }

            var baseUrl = $"{Request.Scheme}://{Request.Host}";

            var imageUrls = await _dbContext.StallMenuImages
                .Where(i => i.FoodStallId == foodStallId)
                .OrderBy(i => i.DisplayOrder)
                .Select(i => BuildImageUrl(i.ImageUrl, baseUrl))
                .ToListAsync();

            return Ok(imageUrls);
        }

        private static string BuildImageUrl(string imageUrl, string baseUrl)
        {
            if (string.IsNullOrWhiteSpace(imageUrl))
            {
                return string.Empty;
            }

            var trimmed = imageUrl.Trim();
            if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return trimmed;
            }

            trimmed = trimmed.TrimStart('/', '\\');
            return $"{baseUrl}/images/{trimmed}";
        }
    }
}
