namespace LittleDays.FamilyApi;

/// <summary>Explicit opt-in for collaborative updates, never deletion or administration.</summary>
public static class RecordEditingPolicy
{
    public const string LastServerSaveWins = "last-server-save-wins-v1";

    public static bool IsCollaborativeUpdate(FullRecordOperation operation) =>
        operation.EditPolicy == LastServerSaveWins && operation.Kind == "update" &&
        operation.ReplacesOperationId is null &&
        (operation.Collection is "entry" or "care" ||
            operation.Collection == "extra" && !FullDomainValidation.IsExtraSingleton(operation.RecordId));
}
