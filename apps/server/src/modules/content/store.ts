import {
  HuntDocumentSchema,
  type CheckpointContent,
  type HuntDocument,
  type QuestionContent,
} from "@signal-hunt/content-tools";
import type { Availability, AvailabilityReason } from "@signal-hunt/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../infrastructure/db/client";
import { cacheVerifiers, huntVersions, hunts } from "../../infrastructure/db/schema";

export interface HuntRecord {
  id: string;
  currentVersion: number;
  availability: Availability;
}

export type { CheckpointContent, HuntDocument, QuestionContent };

/**
 * Read access to registered private content. Version documents are immutable, so they are cached
 * after the first read; availability and the current version are deployed metadata and are read
 * from the database every time.
 */
export class ContentStore {
  private readonly documents = new Map<string, HuntDocument>();
  private readonly questionIndex = new WeakMap<HuntDocument, Map<string, QuestionContent>>();

  findHunt(db: Db, huntId: string): HuntRecord | undefined {
    const row = db.select().from(hunts).where(eq(hunts.id, huntId)).get();
    return row ? toRecord(row) : undefined;
  }

  listHunts(db: Db): HuntRecord[] {
    return db.select().from(hunts).orderBy(asc(hunts.id)).all().map(toRecord);
  }

  findDocument(db: Db, huntId: string, version: number): HuntDocument | undefined {
    const cacheKey = `${huntId}@${version}`;
    const cached = this.documents.get(cacheKey);
    if (cached) return cached;
    const row = db
      .select({ document: huntVersions.document })
      .from(huntVersions)
      .where(and(eq(huntVersions.huntId, huntId), eq(huntVersions.version, version)))
      .get();
    if (!row) return undefined;
    const document = HuntDocumentSchema.parse(JSON.parse(row.document));
    this.documents.set(cacheKey, document);
    return document;
  }

  /** For versions referenced by a run; the foreign key guarantees they exist. */
  getDocument(db: Db, huntId: string, version: number): HuntDocument {
    const document = this.findDocument(db, huntId, version);
    if (!document) throw new Error("Registered hunt version is missing");
    return document;
  }

  getQuestion(document: HuntDocument, questionId: string): QuestionContent {
    let index = this.questionIndex.get(document);
    if (!index) {
      index = new Map();
      for (const checkpoint of document.checkpoints) {
        for (const question of checkpoint.questions) index.set(question.id, question);
      }
      this.questionIndex.set(document, index);
    }
    const question = index.get(questionId);
    if (!question) throw new Error("Selected question is missing from its pinned version");
    return question;
  }

  findCacheTokenHash(db: Db, huntId: string, version: number): string | undefined {
    return db
      .select({ tokenHash: cacheVerifiers.tokenHash })
      .from(cacheVerifiers)
      .where(and(eq(cacheVerifiers.huntId, huntId), eq(cacheVerifiers.version, version)))
      .get()?.tokenHash;
  }
}

function toRecord(row: typeof hunts.$inferSelect): HuntRecord {
  return {
    id: row.id,
    currentVersion: row.currentVersion,
    availability: {
      available: row.available,
      reasonCode: row.available ? null : ((row.unavailableReason as AvailabilityReason | null) ?? "withdrawn"),
    },
  };
}
