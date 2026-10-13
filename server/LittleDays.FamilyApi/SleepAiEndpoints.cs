namespace LittleDays.FamilyApi;

public static class SleepAiEndpoints
{
    // Caller is the existing JWT-protected, directory-admitted /v2 group.
    public static RouteGroupBuilder MapSleepPredictions(this RouteGroupBuilder api)
    {
        api.MapGet("/sleep-predictions/capabilities", (Microsoft.Extensions.Options.IOptions<SleepAiOptions> options) =>
            TypedResults.Ok(new SleepPredictionCapabilities(options.Value.IsAvailable, SleepAiValidation.ConsentVersion, "OpenAI", true)))
            .WithName("SleepPredictionCapabilities")
            .WithSummary("Read availability before requesting consent or sending records.")
            .Produces<SleepPredictionCapabilities>();
        api.MapPost("/sleep-predictions", async (HttpContext context, ISleepAiService service, CancellationToken ct) =>
        {
            var request = await context.Request.ReadFromJsonAsync<SleepPredictionRequest>(SleepAiJson.Options, ct)
                ?? throw new ApiException(422, "invalid_input");
            return TypedResults.Ok(await service.PredictAsync(PublicIdentityAdmission.Get(context), request, ct));
        }).RequireRateLimiting("sensitive")
            .WithName("CreateSleepPrediction")
            .WithSummary("Validate and return optional AI-only sleep periods; never stores input records.")
            .WithDescription("Schema 1 retains future-only periods and consent v1. Schema 2 requires consent v2 and explicit previousEstimate, preserves observed whole-day sleep, and expires at the next local midnight.")
            .Produces<SleepPredictionResponse>()
            .Produces(401).Produces(403).Produces(409).Produces(410).Produces(422).Produces(429).Produces(503);
        return api;
    }
}
