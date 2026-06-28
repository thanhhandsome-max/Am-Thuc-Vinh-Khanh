# Sử dụng .NET SDK 10 để build project
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /app

# Copy file cấu hình và tải các thư viện (Restore)
COPY *.csproj ./
RUN dotnet restore

# Copy toàn bộ code còn lại và Publish (Biên dịch)
COPY . ./
RUN dotnet publish -c Release -o /out

# Sử dụng .NET Runtime 10 gọn nhẹ để chạy ứng dụng (tiết kiệm RAM)
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out .

# Render thường dùng cổng 8080 (hoặc 10000)
# Chúng ta sẽ ép ASP.NET Core lắng nghe trên cổng 8080
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

# Chạy ứng dụng
ENTRYPOINT ["dotnet", "Backend.dll"]
