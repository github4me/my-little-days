import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDeletionReceipt,
  type DeletionReceipt,
} from "./family/deletionReceiptTypes";

const receipt: DeletionReceipt = {
  apiUrl: "https://pilot.example.test",
  deletionId: "00000000-0000-4000-8000-000000000001",
  receiptSecret: "f".repeat(64),
  status: "pending",
  requestedAt: "2026-09-14T00:00:00.000Z",
};
test("deletion receipt is origin bound and keeps no identity or family payload", () => {
  assert.deepEqual(
    parseDeletionReceipt(
      JSON.stringify({ ...receipt, email: "test@example.test", feeds: [] }),
      receipt.apiUrl,
    ),
    receipt,
  );
  assert.equal(
    parseDeletionReceipt(JSON.stringify(receipt), "https://other.example.test"),
    null,
  );
  assert.equal(parseDeletionReceipt(JSON.stringify(receipt), undefined), null);
});
test("invalid deletion receipt cannot be used to send a request", () => {
  for (const patch of [
    { deletionId: "../other" },
    { receiptSecret: "short" },
    { status: "active" },
    { requestedAt: "invalid" },
  ]) {
    assert.equal(
      parseDeletionReceipt(
        JSON.stringify({ ...receipt, ...patch }),
        receipt.apiUrl,
      ),
      null,
    );
  }
  assert.equal(parseDeletionReceipt("not-json", receipt.apiUrl), null);
  assert.equal(parseDeletionReceipt(null, receipt.apiUrl), null);
});
