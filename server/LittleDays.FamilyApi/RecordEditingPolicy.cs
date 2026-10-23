namespace LittleDays.FamilyApi;

/// <summary>Explicit shared-record conflict policies, never administration or singleton settings.</summary>
public static class RecordEditingPolicy
{
    public const string LastServerSaveWins = "last-server-save-wins-v1";
    public const string FirstDeleteWins = "first-delete-wins-v1";

    public static bool IsCollaborativeSave(FullRecordOperation operation) =>
        operation.EditPolicy == LastServerSaveWins && operation.Kind is "create" or "update" &&
        IsSharedRecord(operation);

    public static bool IsFirstDeleteWins(FullRecordOperation operation) =>
        operation.EditPolicy == FirstDeleteWins && operation.Kind == "delete" &&
        IsSharedRecord(operation);

    private static bool IsSharedRecord(FullRecordOperation operation) =>
        operation.ReplacesOperationId is null &&
        (operation.Collection is "entry" or "care" ||
            operation.Collection == "extra" && !FullDomainValidation.IsExtraSingleton(operation.RecordId));
}
