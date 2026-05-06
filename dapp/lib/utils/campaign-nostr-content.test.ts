import {
  buildQuestChainStub,
  buildQuestContentPayload,
  getQuestContentNeventId,
  mergeQuestContentPayload,
  QUEST_CONTENT_FORMAT,
  QUEST_CONTENT_VERSION,
} from "./campaign-nostr-content";
import type { QuestDataLike } from "ssri-ckboost/types";

const quest: QuestDataLike = {
  quest_id: 1,
  metadata: {
    title: "Quest title",
    short_description: "Short summary",
    long_description: "Detailed instructions",
    requirements: "Submit proof",
    difficulty: 2,
    time_estimate: 30,
  },
  rewards_on_completion: [],
  accepted_submission_user_type_ids: [],
  completion_deadline: 0,
  status: 1,
  sub_tasks: [
    {
      id: 1,
      title: "Subtask title",
      type: "technical",
      description: "Subtask details",
      proof_required: "Screenshot",
    },
  ],
  points: 100,
  completion_count: 0,
};

describe("campaign Nostr quest content helpers", () => {
  it("builds a full quest payload for off-chain storage", () => {
    const payload = buildQuestContentPayload(quest);

    expect(payload).toMatchObject({
      format: QUEST_CONTENT_FORMAT,
      version: QUEST_CONTENT_VERSION,
      quest_id: 1,
      metadata: quest.metadata,
      sub_tasks: quest.sub_tasks,
    });
  });

  it("stores only a quest reference and minimal display metadata on chain", () => {
    const stub = buildQuestChainStub(quest, "nevent1questcontent");

    expect(stub.metadata).toMatchObject({
      title: "Quest title",
      short_description: "Short summary",
      long_description: "nevent1questcontent",
      requirements: "",
      difficulty: 2,
      time_estimate: 30,
    });
    expect(stub.sub_tasks).toEqual([]);
    expect(getQuestContentNeventId(stub)).toBe("nevent1questcontent");
  });

  it("merges stored quest content back into a chain stub", () => {
    const stub = buildQuestChainStub(quest, "nevent1questcontent");
    const restored = mergeQuestContentPayload(
      stub,
      JSON.stringify(buildQuestContentPayload(quest))
    );

    expect(restored?.metadata.long_description).toBe("Detailed instructions");
    expect(restored?.metadata.requirements).toBe("Submit proof");
    expect(restored?.sub_tasks).toEqual(quest.sub_tasks);
  });
});
