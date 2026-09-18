using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace LittleDays.FamilyApi;

public sealed record PushEnvelope(string Token, string Locale, Guid EventId, Guid FamilyId, Guid MembershipId,
    Guid HistoryId, Guid InstallationId, int Generation, DateTimeOffset ExpiresAt);
public sealed record PushGatewayResult(string Outcome, string? ReceiptId = null, string Error = "");
public interface IPushGateway
{
    Task<PushGatewayResult> Send(PushEnvelope envelope, CancellationToken ct);
    Task<PushGatewayResult> Receipt(string receiptId, CancellationToken ct);
}

public sealed class ExpoPushGateway(HttpClient http, PushSettings settings, TimeProvider clock) : IPushGateway
{
    public Task<PushGatewayResult> Send(PushEnvelope envelope, CancellationToken ct) => Request("send", new
    {
        to = envelope.Token,
        title = "My Little Days",
        body = envelope.Locale == "zh" ? "家庭记录已更新。" : "Family records updated.",
        sound = "default",
        channelId = "family-entries",
        ttl = Math.Clamp((int)(envelope.ExpiresAt - clock.GetUtcNow()).TotalSeconds, 0, 86400),
        data = new { kind = "family-entry", eventId = envelope.EventId, familyId = envelope.FamilyId,
            membershipId = envelope.MembershipId, historyId = envelope.HistoryId,
            installationId = envelope.InstallationId, generation = envelope.Generation }
    }, null, ct);

    public Task<PushGatewayResult> Receipt(string receiptId, CancellationToken ct) =>
        Request("getReceipts", new { ids = new[] { receiptId } }, receiptId, ct);

    private async Task<PushGatewayResult> Request(string path, object payload, string? receiptId, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://exp.host/--/api/v2/push/" + path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.AccessToken);
            request.Content = JsonContent.Create(payload);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500)
                return new("retry", Error: "provider_unavailable");
            if (!response.IsSuccessStatusCode) return new("failed", Error: "provider_rejected");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            var bytes = new byte[65537];
            var length = 0;
            while (length < bytes.Length)
            {
                var read = await stream.ReadAsync(bytes.AsMemory(length), timeout.Token);
                if (read == 0) break;
                length += read;
            }
            if (length > 65536) return new("retry", Error: "provider_response_invalid");
            using var json = JsonDocument.Parse(bytes.AsMemory(0, length), new() { MaxDepth = 12 });
            return Parse(json.RootElement, receiptId);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new("retry", Error: "provider_timeout"); }
        catch (HttpRequestException) { return new("retry", Error: "provider_unavailable"); }
        catch (JsonException) { return new("retry", Error: "provider_response_invalid"); }
    }

    public static PushGatewayResult Parse(JsonElement root, string? receiptId)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var item))
            return new("retry", Error: "provider_response_invalid");
        if (receiptId is not null)
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty(receiptId, out item))
                return new("retry", Error: "receipt_pending");
        }
        if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String)
            return new("retry", Error: "provider_response_invalid");
        if (status.GetString() == "ok")
        {
            if (receiptId is not null) return new("sent");
            if (item.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String &&
                id.GetString() is { Length: > 0 and <= 128 } text && !text.Any(char.IsControl)) return new("accepted", text);
            return new("retry", Error: "provider_response_invalid");
        }
        if (status.GetString() != "error") return new("retry", Error: "provider_response_invalid");
        var error = item.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object &&
            details.TryGetProperty("error", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null;
        return error switch
        {
            "DeviceNotRegistered" => new("unregistered", Error: "device_not_registered"),
            "MessageRateExceeded" => new("retry", Error: "provider_rate_limited"),
            "MessageTooBig" or "MismatchSenderId" or "InvalidCredentials" => new("failed", Error: "provider_configuration"),
            _ => new("failed", Error: "provider_rejected")
        };
    }
}
