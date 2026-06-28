using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Services;
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
});
builder.Services.AddHttpClient();

// Database connection (PostgreSQL with SQLite fallback for local development)
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
var useSqlite = string.IsNullOrWhiteSpace(connectionString)
    || connectionString.Contains("YOUR_", StringComparison.OrdinalIgnoreCase)
    || connectionString.Contains("YOUR_POSTGRES_HOST", StringComparison.OrdinalIgnoreCase)
    || connectionString.Contains("YOUR_DB_NAME", StringComparison.OrdinalIgnoreCase)
    || connectionString.Contains("YOUR_DB_USER", StringComparison.OrdinalIgnoreCase)
    || connectionString.Contains("YOUR_DB_PASSWORD", StringComparison.OrdinalIgnoreCase);

if (useSqlite)
{
    Console.WriteLine("Using SQLite fallback because the PostgreSQL connection string is not configured.");
}

if (useSqlite)
{
    builder.Services.AddDbContext<AppDbContext>(options =>
        options.UseSqlite("Data Source=StreetFoodQ4.db"));
}
else
{
    builder.Services.AddDbContext<AppDbContext>(options =>
        options.UseNpgsql(connectionString!));
}

// Dependency Injection
builder.Services.AddScoped<ITranslationService, TranslationService>();
builder.Services.AddSingleton<IStallMetadataTranslationService, StallMetadataTranslationService>();
builder.Services.AddScoped<IEdgeTtsService, EdgeTtsService>();
builder.Services.AddScoped<IAudioGenerationPipeline, AudioGenerationPipeline>();
builder.Services.AddScoped<IVisitService, VisitService>();

// Swagger/OpenAPI setup
builder.Services.AddOpenApi();

// Allow any origin for mobile testing
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("AllowAll");
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// Serve static files (Crucial for MP3 downloads from wwwroot)
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
    }
});

app.UseAuthorization();
app.MapControllers();

// Initialize Database & Seed Sample Data
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<AppDbContext>();
        context.Database.EnsureCreated();

        await EnsureUserProfileColumnsAsync(context);
        await EnsureFoodStallColumnsAsync(context);
        await EnsurePendingUserProfileChangesTableAsync(context);
        await EnsureMenuAndVisitTablesAsync(context);

        // Seed Default Admin User if not exists
        if (!context.Users.Any(u => u.Role == "Admin"))
        {
            EncryptionHelper.HashPassword("admin123", out string hash, out string salt);
            context.Users.Add(new Backend.Models.User
            {
                Id = Guid.NewGuid(),
                Username = "admin",
                PasswordHash = hash,
                PasswordSalt = salt,
                Role = "Admin",
                IsVerified = true,
                HasPaidAccess = true,
                DeviceUniqueId = "admin_device",
                LastActive = DateTime.UtcNow
            });
            context.SaveChanges();
            Console.WriteLine("Admin user seeded successfully (admin / admin123).");
        }

        var exemptUsers = context.Users.Where(u => (u.Role == "Admin" || u.Role == "Owner") && !u.HasPaidAccess).ToList();
        if (exemptUsers.Count > 0)
        {
            foreach (var user in exemptUsers)
            {
                user.HasPaidAccess = true;
                user.PaymentActivatedAt ??= DateTime.UtcNow;
            }

            context.SaveChanges();
        }
    }
    catch (Exception ex)
    {
        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "An error occurred while migrating or seeding the database.");
    }
}

app.Run();

static async Task EnsureUserProfileColumnsAsync(Backend.Data.AppDbContext context)
{
    var providerName = context.Database.ProviderName ?? string.Empty;
    var existingColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    try
    {
        await using var command = context.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT * FROM \"Users\" LIMIT 0;";
        if (command.Connection.State != System.Data.ConnectionState.Open)
        {
            await command.Connection.OpenAsync();
        }
        await using (var reader = await command.ExecuteReaderAsync())
        {
            for (int i = 0; i < reader.FieldCount; i++)
            {
                existingColumns.Add(reader.GetName(i));
            }
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error reading schema with quotes: {ex.Message}. Trying without quotes...");
        try
        {
            await using var command = context.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT * FROM Users LIMIT 0;";
            if (command.Connection.State != System.Data.ConnectionState.Open)
            {
                await command.Connection.OpenAsync();
            }
            await using (var reader = await command.ExecuteReaderAsync())
            {
                for (int i = 0; i < reader.FieldCount; i++)
                {
                    existingColumns.Add(reader.GetName(i));
                }
            }
        }
        catch (Exception ex2)
        {
            Console.WriteLine($"Failed to query Users table schema: {ex2.Message}");
            return;
        }
    }

    var addColumnCommands = new List<string>();
    bool isSqlite = providerName.Contains("Sqlite", StringComparison.OrdinalIgnoreCase);

    string textType = isSqlite ? "TEXT" : "text";
    string boolType = isSqlite ? "INTEGER" : "boolean";
    string boolFalse = isSqlite ? "0" : "false";
    string boolTrue = isSqlite ? "1" : "true";

    // User Profile Columns
    if (!existingColumns.Contains("FullName"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"FullName\" {textType} NOT NULL DEFAULT '';");
    if (!existingColumns.Contains("PhoneNumber"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"PhoneNumber\" {textType} NOT NULL DEFAULT '';");
    if (!existingColumns.Contains("Email"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"Email\" {textType} NOT NULL DEFAULT '';");
    if (!existingColumns.Contains("AvatarUrl"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"AvatarUrl\" {textType} NOT NULL DEFAULT '';");
    if (!existingColumns.Contains("is_Active"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"is_Active\" {boolType} NOT NULL DEFAULT {boolTrue};");
    if (!existingColumns.Contains("CccdEncrypted"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"CccdEncrypted\" {textType} NOT NULL DEFAULT '';");

    // Billing / Paid Access Columns
    if (!existingColumns.Contains("HasPaidAccess"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"HasPaidAccess\" {boolType} NOT NULL DEFAULT {boolFalse};");
    if (!existingColumns.Contains("PaymentActivatedAt"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"PaymentActivatedAt\" {(isSqlite ? "TEXT" : "timestamp with time zone")} NULL;");
    if (!existingColumns.Contains("HasPaid"))
        addColumnCommands.Add($"ALTER TABLE \"Users\" ADD COLUMN \"HasPaid\" {boolType} NOT NULL DEFAULT {boolFalse};");

    foreach (var sql in addColumnCommands)
    {
        try
        {
            await context.Database.ExecuteSqlRawAsync(sql);
            Console.WriteLine($"Executed migration: {sql}");
        }
        catch (Exception ex)
        {
            // Try fallback without quotes
            try
            {
                var fallbackSql = sql.Replace("\"", "");
                await context.Database.ExecuteSqlRawAsync(fallbackSql);
                Console.WriteLine($"Executed fallback migration: {fallbackSql}");
            }
            catch (Exception ex2)
            {
                Console.WriteLine($"Failed to run migration '{sql}'. Error: {ex.Message} (Fallback error: {ex2.Message})");
            }
        }
    }

    await EnsurePaymentTransactionsTableAsync(context);
}

static Task EnsureUserBillingColumnsAsync(Backend.Data.AppDbContext context)
{
    // All billing columns are now checked and managed in EnsureUserProfileColumnsAsync
    return Task.CompletedTask;
}

static async Task EnsurePaymentTransactionsTableAsync(Backend.Data.AppDbContext context)
{
    var providerName = context.Database.ProviderName ?? string.Empty;

    if (providerName.Contains("Sqlite", StringComparison.OrdinalIgnoreCase))
    {
        await context.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS PaymentTransactions (
                Id TEXT NOT NULL PRIMARY KEY,
                UserId TEXT NOT NULL,
                TransactionId TEXT NOT NULL,
                ResponseCode TEXT NOT NULL,
                IsSuccess INTEGER NOT NULL,
                CreatedAt TEXT NOT NULL,
                FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE
            );
        ");
        return;
    }

    if (providerName.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) || providerName.Contains("PostgreSQL", StringComparison.OrdinalIgnoreCase))
    {
        await context.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""PaymentTransactions"" (
                ""Id"" uuid NOT NULL PRIMARY KEY,
                ""UserId"" uuid NOT NULL,
                ""TransactionId"" text NOT NULL,
                ""ResponseCode"" text NOT NULL,
                ""IsSuccess"" boolean NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL,
                CONSTRAINT ""FK_PaymentTransactions_Users_UserId"" FOREIGN KEY (""UserId"") REFERENCES ""Users"" (""Id"") ON DELETE CASCADE
            );
        ");
    }
}

static async Task EnsureMenuAndVisitTablesAsync(Backend.Data.AppDbContext context)
{
    var providerName = context.Database.ProviderName ?? string.Empty;

    if (providerName.Contains("Sqlite", StringComparison.OrdinalIgnoreCase))
    {
        await context.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS StallVisits (
                Id TEXT NOT NULL PRIMARY KEY,
                FoodStallId TEXT NOT NULL,
                UserId TEXT NOT NULL,
                ActionType TEXT NOT NULL,
                UserLatitude REAL NOT NULL,
                UserLongitude REAL NOT NULL,
                DistanceMeter REAL NOT NULL,
                IsValidVisit INTEGER NOT NULL,
                CreatedAt TEXT NOT NULL,
                FOREIGN KEY(FoodStallId) REFERENCES FoodStalls(Id) ON DELETE CASCADE,
                FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS IX_StallVisits_UserId_FoodStallId_CreatedAt ON StallVisits(UserId, FoodStallId, CreatedAt);

            CREATE TABLE IF NOT EXISTS StallMenuImages (
                Id TEXT NOT NULL PRIMARY KEY,
                FoodStallId TEXT NOT NULL,
                ImageUrl TEXT NOT NULL,
                IsMainImage INTEGER NOT NULL,
                DisplayOrder INTEGER NOT NULL,
                CreatedAt TEXT NOT NULL,
                FOREIGN KEY(FoodStallId) REFERENCES FoodStalls(Id) ON DELETE CASCADE
            );
        ");
        return;
    }

    if (providerName.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) || providerName.Contains("PostgreSQL", StringComparison.OrdinalIgnoreCase))
    {
        await context.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""StallVisits"" (
                ""Id"" uuid NOT NULL PRIMARY KEY,
                ""FoodStallId"" uuid NOT NULL,
                ""UserId"" uuid NOT NULL,
                ""ActionType"" text NOT NULL,
                ""UserLatitude"" double precision NOT NULL,
                ""UserLongitude"" double precision NOT NULL,
                ""DistanceMeter"" double precision NOT NULL,
                ""IsValidVisit"" boolean NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL,
                CONSTRAINT ""FK_StallVisits_FoodStalls_FoodStallId"" FOREIGN KEY (""FoodStallId"") REFERENCES ""FoodStalls"" (""Id"") ON DELETE CASCADE,
                CONSTRAINT ""FK_StallVisits_Users_UserId"" FOREIGN KEY (""UserId"") REFERENCES ""Users"" (""Id"") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS ""IX_StallVisits_UserId_FoodStallId_CreatedAt"" ON ""StallVisits""(""UserId"", ""FoodStallId"", ""CreatedAt"");

            CREATE TABLE IF NOT EXISTS ""StallMenuImages"" (
                ""Id"" uuid NOT NULL PRIMARY KEY,
                ""FoodStallId"" uuid NOT NULL,
                ""ImageUrl"" text NOT NULL,
                ""IsMainImage"" boolean NOT NULL,
                ""DisplayOrder"" integer NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL,
                CONSTRAINT ""FK_StallMenuImages_FoodStalls_FoodStallId"" FOREIGN KEY (""FoodStallId"") REFERENCES ""FoodStalls"" (""Id"") ON DELETE CASCADE
            );
        ");
    }
}

static List<Backend.Models.FoodStall> LoadSeedFoodStalls(string contentRootPath)
{
    var seedFoodStalls = new List<Backend.Models.FoodStall>
    {
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            Name = "Ốc Oanh",
            Address = "534 Vĩnh Khánh, Phường 8, Quận 4",
            Latitude = 10.760124,
            Longitude = 106.702958,
            OriginalHistory = "Ốc Oanh là một trong những quán ốc nổi tiếng nhất Quận 4 trên đường Vĩnh Khánh. Quán nổi tiếng với các món ốc xào bơ tỏi, ốc hương rang muối ớt và các loại sò điệp nướng mỡ hành. Không gian quán ngoài trời đông đúc, nhộn nhịp đặc trưng ẩm thực đường phố Sài Gòn.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("22222222-2222-2222-2222-222222222222"),
            Name = "Phá Lấu Bò Cô Thảo",
            Address = "243/29G Tôn Đản, Phường 15, Quận 4",
            Latitude = 10.758364,
            Longitude = 106.705291,
            OriginalHistory = "Phá lấu bò Cô Thảo là quán ăn lâu đời phục vụ món phá lấu bò truyền thống ăn kèm với bánh mì hoặc mì gói. Nước lèo béo thơm nước cốt dừa, lòng bò dai giòn sần sật ăn kèm nước mắm tắc chua ngọt đậm đà.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            Name = "Bánh Mì Kẹp Thịt nướng Cô Lệ",
            Address = "104 Vĩnh Khánh, Phường 10, Quận 4",
            Latitude = 10.761245,
            Longitude = 106.700124,
            OriginalHistory = "Bánh mì Cô Lệ nổi tiếng với những xiên thịt nướng được tẩm ướp đậm đà, nướng trực tiếp trên than hồng. Ổ bánh mì giòn rụm kẹp thịt nướng nóng hổi, dưa leo, đồ chua và nước sốt tương đặc trưng, thơm phức cả một góc phố.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("44444444-4444-4444-4444-444444444444"),
            Name = "Cà Phê Spotlight",
            Address = "Quận 4",
            Latitude = 10.7645525,
            Longitude = 106.7036887,
            OriginalHistory = "Cà Phê Spotlight là quán cà phê nhỏ ấm cúng với phong cách hiện đại, phục vụ cà phê, trà và đồ uống đặc sắc. Đây là điểm dừng chân lý tưởng cho người đi bộ quanh Quận 4.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("55555555-5555-5555-5555-555555555555"),
            Name = "Ốc Phát",
            Address = "Quận 4",
            Latitude = 10.7619120,
            Longitude = 106.7021560,
            OriginalHistory = "Ốc Phát là quán ốc đặc trưng của khu Vĩnh Khánh, nổi tiếng với ốc luộc, ốc xào me và không gian đông khách. Món ăn được nêm nếm vừa miệng, thích hợp cho nhóm bạn đi ăn tối.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("66666666-6666-6666-6666-666666666666"),
            Name = "Cà Phê Trần",
            Address = "81 Bến Vân Đồn, Quận 4",
            Latitude = 10.7647704,
            Longitude = 106.7015087,
            OriginalHistory = "Cà Phê Trần phục vụ cà phê thơm ngon cùng không gian thoáng đãng, có wifi miễn phí và khu vực ngoài trời. Quán phù hợp cho người muốn nghỉ ngơi sau khi tham quan ẩm thực xung quanh.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("77777777-7777-7777-7777-777777777777"),
            Name = "Quán Nướng Bơ",
            Address = "128 Vĩnh Khánh, Quận 4",
            Latitude = 10.7608066,
            Longitude = 106.7046253,
            OriginalHistory = "Quán Nướng Bơ nổi bật với món nướng bơ thơm béo và các món hải sản, thịt nướng ăn kèm rau sống. Quán mở cửa đêm, thu hút đông thực khách trẻ khu vực Quận 4.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("88888888-8888-8888-8888-888888888888"),
            Name = "Cộng Cà Phê",
            Address = "168 Đường Khánh Hội, Quận 4",
            Latitude = 10.7580147,
            Longitude = 106.6999221,
            OriginalHistory = "Cộng Cà Phê là thương hiệu cà phê nổi tiếng với không gian retro, phục vụ cà phê và đồ uống giải khát. Đây là lựa chọn quen thuộc cho người trẻ và khách du lịch khi đi qua Quận 4.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("99999999-9999-9999-9999-999999999999"),
            Name = "The Coffee House",
            Address = "Số 9 Đường Vĩnh Hội, Quận 4",
            Latitude = 10.7587290,
            Longitude = 106.7005406,
            OriginalHistory = "The Coffee House là chuỗi cà phê phục vụ cafe, trà sữa và bánh ngọt, phù hợp cho khách hàng muốn nghỉ chân trong hành trình khám phá ẩm thực Quận 4.",
            IsVerified = true
        },
        new Backend.Models.FoodStall
        {
            Id = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            Name = "Bún Bò 5T",
            Address = "70 Nguyễn Trường Tộ, Quận 4",
            Latitude = 10.7646988,
            Longitude = 106.7050879,
            OriginalHistory = "Bún Bò 5T là quán bún bò ngon ở Quận 4, gân giò mềm, nước dùng đậm đà và hành tươi thơm. Quán được nhiều thực khách địa phương chọn làm bữa sáng hoặc bữa trưa.",
            IsVerified = true
        }
    };

    var osmFilePath = Path.Combine(contentRootPath, "Tahn.txt");
    if (File.Exists(osmFilePath))
    {
        var osmFoodStalls = LoadFoodStallsFromOsm(osmFilePath);
        seedFoodStalls.AddRange(osmFoodStalls);
        Console.WriteLine($"Loaded {osmFoodStalls.Count} OSM stalls from {osmFilePath}");
    }
    else
    {
        Console.WriteLine($"OSM import file not found at {osmFilePath}. Skipping OSM seed import.");
    }

    return seedFoodStalls;
}

static List<Backend.Models.FoodStall> LoadFoodStallsFromOsm(string osmFilePath)
{
    var json = File.ReadAllText(osmFilePath, Encoding.UTF8);
    using var document = JsonDocument.Parse(json);
    var root = document.RootElement;
    var result = new List<Backend.Models.FoodStall>();

    if (!root.TryGetProperty("elements", out var elements))
    {
        return result;
    }

    foreach (var element in elements.EnumerateArray())
    {
        if (!element.TryGetProperty("type", out var typeElement) || typeElement.GetString() != "node")
            continue;

        if (!element.TryGetProperty("tags", out var tags))
            continue;

        if (!TryGetName(tags, out var name))
            continue;

        var latitude = element.TryGetProperty("lat", out var latElement) ? latElement.GetDouble() : 0;
        var longitude = element.TryGetProperty("lon", out var lonElement) ? lonElement.GetDouble() : 0;
        var address = BuildAddress(tags);
        if (string.IsNullOrWhiteSpace(address))
        {
            address = "Quận 4, TP.HCM";
        }

        var stall = new Backend.Models.FoodStall
        {
            Id = CreateDeterministicGuid($"{name}|{latitude}|{longitude}"),
            Name = name,
            Address = address,
            Latitude = latitude,
            Longitude = longitude,
            OriginalHistory = BuildOriginalHistory(name, address, tags),
            IsVerified = true
        };

        result.Add(stall);
    }

    return result;
}

static bool TryGetName(JsonElement tags, out string name)
{
    name = string.Empty;
    foreach (var key in new[] { "name", "name:vi", "name:en" })
    {
        if (tags.TryGetProperty(key, out var value) && !string.IsNullOrWhiteSpace(value.GetString()))
        {
            name = value.GetString()!;
            return true;
        }
    }

    return false;
}

static string BuildAddress(JsonElement tags)
{
    var parts = new List<string>();
    foreach (var key in new[] { "addr:housenumber", "addr:street", "addr:subdistrict", "addr:district", "addr:city", "addr:province", "addr:postcode" })
    {
        if (tags.TryGetProperty(key, out var value) && !string.IsNullOrWhiteSpace(value.GetString()))
        {
            parts.Add(value.GetString()!);
        }
    }

    return string.Join(", ", parts);
}

static string BuildOriginalHistory(string name, string address, JsonElement tags)
{
    var amenity = tags.TryGetProperty("amenity", out var amenityValue) ? amenityValue.GetString() : null;
    var cuisine = tags.TryGetProperty("cuisine", out var cuisineValue) ? cuisineValue.GetString() : null;

    var description = amenity is not null
        ? $"{name} là một điểm {amenity.Replace('_', ' ')}"
        : $"{name} là một điểm ẩm thực";

    if (!string.IsNullOrWhiteSpace(cuisine))
    {
        description += $" phục vụ {cuisine.Replace('_', ' ')}";
    }

    description += $" tại {address}.";
    description += " Thông tin được nhập từ dữ liệu OpenStreetMap.";

    return description;
}

static Guid CreateDeterministicGuid(string input)
{
    using var md5 = MD5.Create();
    var hash = md5.ComputeHash(Encoding.UTF8.GetBytes(input));
    return new Guid(hash);
}

static async Task EnsureFoodStallColumnsAsync(Backend.Data.AppDbContext context)
{
    var providerName = context.Database.ProviderName ?? string.Empty;
    var existingColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    try
    {
        await using var command = context.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT * FROM \"FoodStalls\" LIMIT 0;";
        if (command.Connection.State != System.Data.ConnectionState.Open)
        {
            await command.Connection.OpenAsync();
        }
        await using (var reader = await command.ExecuteReaderAsync())
        {
            for (int i = 0; i < reader.FieldCount; i++)
            {
                existingColumns.Add(reader.GetName(i));
            }
        }
    }
    catch (Exception)
    {
        try
        {
            await using var command = context.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT * FROM FoodStalls LIMIT 0;";
            if (command.Connection.State != System.Data.ConnectionState.Open)
            {
                await command.Connection.OpenAsync();
            }
            await using (var reader = await command.ExecuteReaderAsync())
            {
                for (int i = 0; i < reader.FieldCount; i++)
                {
                    existingColumns.Add(reader.GetName(i));
                }
            }
        }
        catch (Exception)
        {
            return;
        }
    }

    var addColumnCommands = new List<string>();
    bool isSqlite = providerName.Contains("Sqlite", StringComparison.OrdinalIgnoreCase);
    string boolType = isSqlite ? "INTEGER" : "boolean";
    string boolTrue = isSqlite ? "1" : "true";

    if (!existingColumns.Contains("is_Active"))
        addColumnCommands.Add($"ALTER TABLE \"FoodStalls\" ADD COLUMN \"is_Active\" {boolType} NOT NULL DEFAULT {boolTrue};");

    foreach (var sql in addColumnCommands)
    {
        try
        {
            await context.Database.ExecuteSqlRawAsync(sql);
            Console.WriteLine($"Executed FoodStalls migration: {sql}");
        }
        catch (Exception)
        {
            try
            {
                var fallbackSql = sql.Replace("\"", "");
                await context.Database.ExecuteSqlRawAsync(fallbackSql);
                Console.WriteLine($"Executed FoodStalls fallback migration: {fallbackSql}");
            }
            catch (Exception)
            {
                // Ignore errors if columns already exist or fail
            }
        }
    }
}

static async Task EnsurePendingUserProfileChangesTableAsync(Backend.Data.AppDbContext context)
{
    var providerName = context.Database.ProviderName ?? string.Empty;

    if (providerName.Contains("Sqlite", StringComparison.OrdinalIgnoreCase))
    {
        await context.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS PendingUserProfileChanges (
                Id TEXT NOT NULL PRIMARY KEY,
                UserId TEXT NOT NULL,
                FullName TEXT NOT NULL DEFAULT '',
                PhoneNumber TEXT NOT NULL DEFAULT '',
                Email TEXT NOT NULL DEFAULT '',
                CreatedAt TEXT NOT NULL,
                FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE
            );
        ");
        return;
    }

    if (providerName.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) || providerName.Contains("PostgreSQL", StringComparison.OrdinalIgnoreCase))
    {
        await context.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""PendingUserProfileChanges"" (
                ""Id"" uuid NOT NULL PRIMARY KEY,
                ""UserId"" uuid NOT NULL,
                ""FullName"" text NOT NULL DEFAULT '',
                ""PhoneNumber"" text NOT NULL DEFAULT '',
                ""Email"" text NOT NULL DEFAULT '',
                ""CreatedAt"" timestamp with time zone NOT NULL,
                CONSTRAINT ""FK_PendingUserProfileChanges_Users_UserId"" FOREIGN KEY (""UserId"") REFERENCES ""Users"" (""Id"") ON DELETE CASCADE
            );
        ");
    }
}

