using System.Text.Encodings.Web;
using System.Text.Json;

namespace LittleDays.FamilyApi;

// Hard service ceilings, independent of a caller's per-record validation. Keep
// imported/offline work on the device when an explicit quota error is returned.
public static class FamilyAvailability
{
    public const long MaxStoredRecordBytes = 64L * 1024 * 1024; // SQL nvarchar payload, including tombstones
    public const long MaxSnapshotBytes = 32L * 1024 * 1024;
    public const int MaxRecords = 10000;
    public const int MaxMemberHistory = 1000;
    public const int CleanupBatchSize = 10;
    public const int MaxClosuresPerDay = 3;
    public const long SnapshotMetadataReserve = 2L * 1024 * 1024;
    public const int RecordEnvelopeReserve = 256;

    // These are application/json responses, never embedded HTML. Avoid expanding
    // base64 '+' characters; all required JSON escaping remains enabled. New extra
    // records are canonicalized with these exact options before byte accounting.
    public static readonly JsonSerializerOptions SnapshotJson = new(JsonSerializerDefaults.Web)
    { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static void RequireBudget(long storedBytes, long liveJsonBytes, int records, int liveRecords, bool enforceRecordCount = true)
    {
        if (enforceRecordCount && records > MaxRecords) throw new ApiException(409, "family_record_limit");
        if (storedBytes > MaxStoredRecordBytes) throw new ApiException(409, "family_storage_limit");
        if (liveJsonBytes + (long)liveRecords * RecordEnvelopeReserve + SnapshotMetadataReserve > MaxSnapshotBytes)
            throw new ApiException(409, "family_snapshot_limit");
    }

    public static T RequireResponseBudget<T>(T value)
    {
        MeasureResponseBytes(value);
        return value;
    }

    public static long MeasureResponseBytes<T>(T value)
    {
        using var stream = new BoundedCountingStream(MaxSnapshotBytes);
        JsonSerializer.Serialize(stream, value, SnapshotJson);
        return stream.Length;
    }

    public static long MeasureRecordResponse(string json)
    {
        using var document = JsonDocument.Parse(json);
        using var stream = new BoundedCountingStream(MaxSnapshotBytes);
        JsonSerializer.Serialize(stream, document.RootElement, SnapshotJson);
        return stream.Length;
    }

    // Verify the actual serializer as well as the conservative SQL preflight,
    // without allocating a second copy of a photo-sized response.
    private sealed class BoundedCountingStream(long limit) : Stream
    {
        private long length;
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => length;
        public override long Position { get => length; set => throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) => Add(count);
        public override void Write(ReadOnlySpan<byte> buffer) => Add(buffer.Length);
        private void Add(int count)
        {
            if (length + count > limit) throw new ApiException(409, "family_snapshot_limit");
            length += count;
        }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}

public sealed record ConditionalSnapshot<T>(string ETag, T? Snapshot) where T : class;
