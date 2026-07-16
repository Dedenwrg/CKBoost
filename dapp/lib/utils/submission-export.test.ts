import {
  buildQuestSubmissionExportData,
  buildQuestResponseEntries,
  EXCEL_MAX_CELL_TEXT_LENGTH,
} from "@/lib/utils/submission-export";
import type {
  QuestDataLike,
  UserDataLike,
  UserSubmissionRecordLike,
} from "ssri-ckboost/types";
import { utils, write } from "xlsx";

const createQuest = (
  overrides: Partial<QuestDataLike> = {}
): QuestDataLike => ({
  quest_id: 7,
  metadata: {
    title: "Share a thread",
    short_description: "Post a campaign thread",
    long_description: "",
    requirements: "",
    difficulty: 0,
    time_estimate: 0,
  },
  rewards_on_completion: [],
  accepted_submission_user_type_ids: [],
  completion_deadline: 0,
  status: 0,
  sub_tasks: [
    {
      id: 1,
      title: "Thread URL",
      type: "url",
      description: "Paste the URL to your thread",
      proof_required: "Public post URL",
    },
  ],
  points: 20,
  completion_count: 0,
  ...overrides,
});

const createUserData = (
  identity: string,
  overrides: Partial<UserDataLike> = {}
): UserDataLike => ({
  verification_data: {
    telegram_personal_chat_id: 0,
    identity_verification_data: identity,
  },
  total_points_earned: 42,
  last_activity_timestamp: 0,
  submission_records: [],
  profile_data: [],
  last_bonus_streak_at: 0,
  ...overrides,
});

const createSubmission = (
  userTypeId: string,
  overrides: Partial<UserSubmissionRecordLike> = {}
): UserSubmissionRecordLike & { userTypeId: string } => ({
  campaign_type_id: "0xcampaign",
  quest_id: 7,
  submission_timestamp: 1_700_000_000_000,
  submission_content: "",
  userTypeId,
  ...overrides,
});

describe("buildQuestResponseEntries", () => {
  it("uses raw text for single-subtask submissions that are not structured JSON", () => {
    const responses = buildQuestResponseEntries(
      createQuest(),
      "https://x.com/example/post"
    );

    expect(responses).toEqual([
      {
        title: "Thread URL",
        description: "Paste the URL to your thread",
        type: "url",
        proofRequired: "Public post URL",
        response: "https://x.com/example/post",
      },
    ]);
  });

  it("uses parsed Nostr subtasks when the on-chain quest stub has no subtasks", () => {
    const responses = buildQuestResponseEntries(
      createQuest({ sub_tasks: [] }),
      JSON.stringify({
        format: "json",
        version: "1",
        timestamp: 1_700_000_000_000,
        subtasks: [
          {
            title: "Thread URL",
            description: "Paste the URL to your thread",
            type: "url",
            proof_required: "Public post URL",
            response: "https://x.com/nostr/post",
          },
        ],
      })
    );

    expect(responses).toEqual([
      {
        title: "Thread URL",
        description: "Paste the URL to your thread",
        type: "url",
        proofRequired: "Public post URL",
        response: "https://x.com/nostr/post",
      },
    ]);
  });
});

describe("buildQuestSubmissionExportData", () => {
  it("exports direct quest submissions and includes approved users without submission records", async () => {
    const quest = createQuest({
      accepted_submission_user_type_ids: ["0xbbb2"],
    });
    const pendingUser = createSubmission("0xaaa1", {
      submission_content: JSON.stringify({
        format: "json",
        version: "1",
        timestamp: 1_700_000_000_000,
        subtasks: [
          {
            title: "Thread URL",
            response: "https://x.com/pending/post",
          },
        ],
      }),
    });
    const userDetails = new Map<string, UserDataLike>([
      [
        "0xaaa1",
        createUserData(
          JSON.stringify({
            name: "Pending User",
            email: "pending@example.com",
            twitter: "@pending",
          })
        ),
      ],
      [
        "0xbbb2",
        createUserData(
          JSON.stringify({
            name: "Approved User",
            discord: "approved-user",
          })
        ),
      ],
    ]);

    const exportData = await buildQuestSubmissionExportData({
      campaignTitle: "Spring Campaign",
      campaignTypeId: "0xcampaign",
      quest,
      submissions: [pendingUser],
      userDetails,
    });

    expect(exportData.filename).toBe(
      "Spring Campaign-Share a thread-submissions.xlsx"
    );
    expect(exportData.headers).toContain("Subtask 1 Response");
    expect(exportData.rows).toHaveLength(2);

    const pendingRow = exportData.rows.find(
      (row) => row["User Type ID"] === "0xaaa1"
    );
    const approvedRow = exportData.rows.find(
      (row) => row["User Type ID"] === "0xbbb2"
    );

    expect(pendingRow).toMatchObject({
      Status: "Pending",
      "User Name": "Pending User",
      "User Email": "pending@example.com",
      "User Twitter": "@pending",
      "Subtask 1 Response": "https://x.com/pending/post",
    });
    expect(approvedRow).toMatchObject({
      Status: "Approved",
      "User Name": "Approved User",
      "User Discord": "approved-user",
      "Raw Submission Reference": "",
      "Subtask 1 Response": "",
    });
  });

  it("resolves Nostr-backed submissions once and maps the fetched response into export columns", async () => {
    const fetchSubmission = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        format: "json",
        version: "1",
        timestamp: 1_700_000_000_000,
        subtasks: [
          {
            title: "Thread URL",
            response: "https://x.com/nostr/post",
          },
        ],
      }),
      eventId: "event-123",
      author: "pubkey-123",
      created_at: 1_700_000_000,
      relays: ["wss://relay.example"],
    });

    const exportData = await buildQuestSubmissionExportData({
      campaignTitle: "Spring Campaign",
      campaignTypeId: "0xcampaign",
      quest: createQuest(),
      submissions: [
        createSubmission("0xaaa1", {
          submission_content: "nevent1cachedsubmission",
        }),
        createSubmission("0xbbb2", {
          submission_timestamp: 1_700_000_000_100,
          submission_content: "nevent1cachedsubmission",
        }),
      ],
      userDetails: new Map<string, UserDataLike>([
        ["0xaaa1", createUserData(JSON.stringify({ name: "Alpha" }))],
        ["0xbbb2", createUserData(JSON.stringify({ name: "Beta" }))],
      ]),
      fetchSubmission,
    });

    expect(fetchSubmission).toHaveBeenCalledTimes(1);
    expect(exportData.rows).toHaveLength(2);
    expect(exportData.rows[0]).toMatchObject({
      "User Name": "Beta",
      "Content Source": "nostr",
      "Nostr Event IDs": "nevent1cachedsubmission",
      "Subtask 1 Response": "https://x.com/nostr/post",
    });
    expect(exportData.rows[1]).toMatchObject({
      "User Name": "Alpha",
      "Content Source": "nostr",
      "Subtask 1 Response": "https://x.com/nostr/post",
    });
  });

  it("splits overlong text into clearly marked continuation rows without data loss", async () => {
    const overlongContent =
      "a".repeat(EXCEL_MAX_CELL_TEXT_LENGTH - 1) + "😀";
    const exportData = await buildQuestSubmissionExportData({
      campaignTitle: "Spring Campaign",
      campaignTypeId: "0xcampaign",
      quest: createQuest(),
      submissions: [
        createSubmission("0xaaa1", {
          submission_content: overlongContent,
        }),
      ],
      userDetails: new Map<string, UserDataLike>(),
    });

    expect(exportData.submissionCount).toBe(1);
    expect(exportData.continuationRowCount).toBe(1);
    expect(exportData.rows).toHaveLength(2);
    expect(exportData.headers).toEqual(
      expect.arrayContaining(["Export Row Type", "Continuation Part"])
    );
    expect(exportData.rows.map((row) => row["Export Row Type"])).toEqual([
      "Submission",
      "Submission continuation",
    ]);
    expect(exportData.rows.map((row) => row["Continuation Part"])).toEqual([
      "1 of 2",
      "2 of 2",
    ]);
    expect(
      exportData.rows
        .map((row) => row["Raw Submission Reference"])
        .join("")
    ).toBe(overlongContent);
    expect(
      exportData.rows
        .map((row) => row["Resolved Submission Content"])
        .join("")
    ).toBe(overlongContent);
    expect(
      exportData.rows.map((row) => row["Subtask 1 Response"]).join("")
    ).toBe(overlongContent);

    for (const row of exportData.rows) {
      expect(row["User Type ID"]).toBe("0xaaa1");
      expect(row["Status"]).toBe("Pending");

      for (const value of Object.values(row)) {
        if (typeof value === "string") {
          expect(value.length).toBeLessThanOrEqual(
            EXCEL_MAX_CELL_TEXT_LENGTH
          );
        }
      }
    }

    const workbook = utils.book_new();
    const worksheet = utils.json_to_sheet(exportData.rows, {
      header: exportData.headers,
    });
    utils.book_append_sheet(workbook, worksheet, exportData.sheetName);

    expect(() => write(workbook, { bookType: "xlsx", type: "array" })).not.toThrow();
  });
});
