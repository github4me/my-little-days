using Microsoft.Extensions.Configuration;

namespace LittleDays.FamilyApi.Tests;

public sealed class DeletionWorkerSettingsTests
{
    [Fact]
    public void DefaultCleanupCadenceLetsFreeSqlAutoPause()
    {
        var settings = DeletionWorkerSettings.Load(new ConfigurationBuilder().Build());
        Assert.Equal(TimeSpan.FromHours(2), settings.PollInterval);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(119)]
    [InlineData(1441)]
    public void InvalidCadenceCannotWakeSqlEveryMinuteOrDelayCleanupIndefinitely(int minutes)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["AccountDeletion:PollIntervalMinutes"] = minutes.ToString() }).Build();
        Assert.Throws<InvalidOperationException>(() => DeletionWorkerSettings.Load(configuration));
    }

    [Theory]
    [InlineData(120)]
    [InlineData(360)]
    [InlineData(1440)]
    public void OperatorCanSelectBoundedCleanupCadence(int minutes)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["AccountDeletion:PollIntervalMinutes"] = minutes.ToString() }).Build();
        Assert.Equal(TimeSpan.FromMinutes(minutes), DeletionWorkerSettings.Load(configuration).PollInterval);
    }
}
