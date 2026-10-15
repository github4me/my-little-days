namespace LittleDays.FamilyApi;

public static class SleepAiEndpoints
{
    // Caller is the existing JWT-protected, directory-admitted /v2 group.
    public static RouteGroupBuilder MapSleepPredictions(this RouteGroupBuilder api)
    {
        api.MapGet("/sleep-prediction-jobs/capabilities", (Microsoft.Extensions.Options.IOptions<SleepAiOptions> options) =>
            TypedResults.Ok(new SleepPredictionJobCapabilities(options.Value.IsAvailable, SleepAiJobPolicy.ConsentVersion)))
            .WithName("SleepPredictionJobCapabilities");
        api.MapPost("/sleep-prediction-jobs", async (HttpContext context, SleepAiJobStore store, SleepAiDiagnostics diagnostics, CancellationToken ct) =>
        {
            var request = await context.Request.ReadFromJsonAsync<CreateSleepPredictionJobRequest>(SleepAiJson.Options, ct)
                ?? throw new ApiException(422, "invalid_input");
            diagnostics.SetJob(request.OperationId);
            var job = await diagnostics.MeasureAsync(SleepAiStage.Enqueue,
                () => store.Enqueue(PublicIdentityAdmission.Get(context), request, ct));
            return TypedResults.Accepted($"/v2/sleep-prediction-jobs/{job.JobId:D}", job);
        }).RequireRateLimiting("sensitive").WithName("CreateSleepPredictionJob")
            .WithSummary("Commit an explicitly consented durable AI task before acknowledging it.")
            .Produces<SleepPredictionJobResponse>(202).Produces(401).Produces(403).Produces(409).Produces(410).Produces(422).Produces(429).Produces(503);
        api.MapGet("/sleep-prediction-jobs/{jobId:guid}", async (Guid jobId, HttpContext context, SleepAiJobStore store, SleepAiDiagnostics diagnostics, CancellationToken ct) =>
        {
            diagnostics.SetJob(jobId);
            var job = await diagnostics.MeasureAsync(SleepAiStage.Poll,
                () => store.Get(PublicIdentityAdmission.Get(context), jobId, ct));
            return TypedResults.Ok(job);
        })
            .WithName("ReadSleepPredictionJob").Produces<SleepPredictionJobResponse>().Produces(404);
        api.MapDelete("/sleep-prediction-jobs/{jobId:guid}", async (Guid jobId, HttpContext context, SleepAiJobStore store, CancellationToken ct) =>
        {
            await store.Cancel(PublicIdentityAdmission.Get(context), jobId, false, ct);
            return TypedResults.NoContent();
        }).WithName("CancelSleepPredictionJob");
        api.MapDelete("/sleep-prediction-jobs/consents/{generation:guid}", async (Guid generation, HttpContext context, SleepAiJobStore store, CancellationToken ct) =>
        {
            await store.Cancel(PublicIdentityAdmission.Get(context), generation, true, ct);
            return TypedResults.NoContent();
        }).WithName("RevokeSleepPredictionJobConsent");
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
            .Produces(401).Produces(403).Produces(409).Produces(410).Produces(422).Produces(429).Produces(503).Produces(504);
        return api;
    }
}
