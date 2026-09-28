namespace LittleDays.FamilyApi;

// Explicit operator-controlled restore maintenance, not automatic restore
// detection or proof that deletion/revocation decisions were reconciled.
public sealed class RecoveryGate(IConfiguration configuration)
{
    public bool Blocked => configuration.GetValue("Recovery:Blocked", false);
}
