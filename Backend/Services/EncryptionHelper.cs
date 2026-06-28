using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Backend.Services
{
    public static class EncryptionHelper
    {
        // Fixed salt size and key derivation iterations for PBKDF2
        private const int SaltSize = 16;
        private const int HashSize = 32;
        private const int Iterations = 10000;

        // Fallback AES encryption key if not provided in config (32 bytes = 256 bits)
        private static readonly byte[] FallbackAesKey = Encoding.UTF8.GetBytes("OcQuan4AdminSystemSecretKey2026!");

        // --- Password Hashing (PBKDF2) ---

        public static void HashPassword(string password, out string hashHex, out string saltHex)
        {
            using (var rng = RandomNumberGenerator.Create())
            {
                byte[] saltBytes = new byte[SaltSize];
                rng.GetBytes(saltBytes);

                byte[] hashBytes = Rfc2898DeriveBytes.Pbkdf2(password, saltBytes, Iterations, HashAlgorithmName.SHA256, HashSize);
                hashHex = Convert.ToHexString(hashBytes);
                saltHex = Convert.ToHexString(saltBytes);
            }
        }

        public static bool VerifyPassword(string password, string hashHex, string saltHex)
        {
            try
            {
                byte[] saltBytes = Convert.FromHexString(saltHex);
                byte[] hashBytes = Convert.FromHexString(hashHex);

                byte[] computedHash = Rfc2898DeriveBytes.Pbkdf2(password, saltBytes, Iterations, HashAlgorithmName.SHA256, HashSize);
                return CryptographicOperations.FixedTimeEquals(computedHash, hashBytes);
            }
            catch
            {
                return false;
            }
        }

        // --- PII Symmetric Encryption (AES-256-CBC) ---

        public static string EncryptCccd(string cccd, string? keyString = null)
        {
            if (string.IsNullOrEmpty(cccd)) return string.Empty;

            byte[] key = string.IsNullOrEmpty(keyString) 
                ? FallbackAesKey 
                : Get32ByteKey(keyString);

            using (var aes = Aes.Create())
            {
                aes.Key = key;
                aes.GenerateIV(); // Unique initialization vector per encryption

                using (var encryptor = aes.CreateEncryptor(aes.Key, aes.IV))
                using (var ms = new MemoryStream())
                {
                    // Write IV first, so it is prepended to the ciphertext
                    ms.Write(aes.IV, 0, aes.IV.Length);

                    using (var cs = new CryptoStream(ms, encryptor, CryptoStreamMode.Write))
                    using (var writer = new StreamWriter(cs))
                    {
                        writer.Write(cccd);
                    }

                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        }

        public static string DecryptCccd(string encryptedBase64, string? keyString = null)
        {
            if (string.IsNullOrEmpty(encryptedBase64)) return string.Empty;

            byte[] key = string.IsNullOrEmpty(keyString) 
                ? FallbackAesKey 
                : Get32ByteKey(keyString);

            try
            {
                byte[] fullCipher = Convert.FromBase64String(encryptedBase64);

                using (var aes = Aes.Create())
                {
                    aes.Key = key;

                    // Extact IV (first 16 bytes)
                    byte[] iv = new byte[aes.BlockSize / 8];
                    Array.Copy(fullCipher, 0, iv, 0, iv.Length);
                    aes.IV = iv;

                    // Extract ciphertext (everything after IV)
                    int cipherLength = fullCipher.Length - iv.Length;
                    byte[] cipherText = new byte[cipherLength];
                    Array.Copy(fullCipher, iv.Length, cipherText, 0, cipherLength);

                    using (var decryptor = aes.CreateDecryptor(aes.Key, aes.IV))
                    using (var ms = new MemoryStream(cipherText))
                    using (var cs = new CryptoStream(ms, decryptor, CryptoStreamMode.Read))
                    using (var reader = new StreamReader(cs))
                    {
                        return reader.ReadToEnd();
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Decryption failed: {ex.Message}");
                return "[Error Decrypting PII]";
            }
        }

        private static byte[] Get32ByteKey(string input)
        {
            byte[] inputBytes = Encoding.UTF8.GetBytes(input);
            using (var sha256 = SHA256.Create())
            {
                return sha256.ComputeHash(inputBytes);
            }
        }
    }
}
