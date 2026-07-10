import type { ccc } from "@ckb-ccc/connector-react";
import {
  removeQuestSubmissionRecords,
  submissionRecordMatchesQuest,
} from "./user-submission-records";

const campaignA = `0x${"11".repeat(32)}` as ccc.Hex;
const campaignB = `0x${"22".repeat(32)}` as ccc.Hex;

const record = (campaignTypeId: ccc.HexLike, questId: number) => ({
  campaign_type_id: campaignTypeId,
  quest_id: questId,
  submission_timestamp: 1n,
  submission_content: "nevent1example",
});

describe("user submission records", () => {
  it("matches decoded byte campaign ids as well as hex strings", () => {
    expect(
      submissionRecordMatchesQuest(
        record(Uint8Array.from({ length: 32 }, () => 0x11), 7),
        campaignA,
        7
      )
    ).toBe(true);
    expect(submissionRecordMatchesQuest(record(campaignA, 7), campaignA, 8)).toBe(
      false
    );
  });

  it("removes only records for the selected campaign and quest", () => {
    const records = [
      record(campaignA, 1),
      record(campaignA, 2),
      record(campaignB, 1),
    ];

    const result = removeQuestSubmissionRecords(records, campaignA, 1);

    expect(result.removedCount).toBe(1);
    expect(result.records).toEqual([records[1], records[2]]);
    expect(records).toHaveLength(3);
  });

  it("removes duplicate records for the same quest defensively", () => {
    const records = [record(campaignA, 1), record(campaignA, 1)];

    const result = removeQuestSubmissionRecords(records, campaignA, 1);

    expect(result.removedCount).toBe(2);
    expect(result.records).toEqual([]);
  });
});
