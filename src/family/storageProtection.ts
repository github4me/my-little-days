import { requireNativeModule } from "expo";
import { Platform } from "react-native";

// The native directory is persistent (not OS-purgeable), and existing files
// stay in place. A missing bridge in an old binary must fail closed on iOS.
export async function protectFamilyStorage(): Promise<void> {
  if (Platform.OS === "ios") {
    await requireNativeModule<{ protect(): Promise<void> }>(
      "FamilyStorageSecurity",
    ).protect();
  }
}
