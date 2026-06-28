using System;
using System.Threading;
using System.Threading.Tasks;

namespace Backend.Services
{
    public static class GeminiRateLimiter
    {
        private static readonly SemaphoreSlim Gate = new(1, 1);
        private static DateTime _lastRequestUtc = DateTime.MinValue;
        private const int MinIntervalMs = 4200;

        public static async Task WaitForTurnAsync()
        {
            await Gate.WaitAsync();
            try
            {
                var elapsed = (DateTime.UtcNow - _lastRequestUtc).TotalMilliseconds;
                if (elapsed < MinIntervalMs)
                {
                    await Task.Delay((int)(MinIntervalMs - elapsed));
                }

                _lastRequestUtc = DateTime.UtcNow;
            }
            finally
            {
                Gate.Release();
            }
        }
    }
}
