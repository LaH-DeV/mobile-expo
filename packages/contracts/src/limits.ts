/**
 * Adopted resource limits and gameplay thresholds. These are public protocol facts, not secrets.
 * Changing any of them is a contract change that must be reflected in the specifications and tests.
 */
export const LIMITS = {
  checkpointsPerHunt: 30,
  questionsPerPool: 20,
  drawCountMax: 5,
  choicesMin: 2,
  choicesMax: 6,
  hintsPerQuestion: 5,
  titleCodePoints: 100,
  promptCodePoints: 1000,
  hintCodePoints: 1000,
  storyCodePoints: 4000,
  revealCodePoints: 4000,
  shortTextCodePoints: 500,
  answerTextCodePoints: 200,
  numericAnswerChars: 40,
  acceptedAliasesPerLocale: 20,
  pageSizeDefault: 20,
  pageSizeMax: 50,
  searchQueryCodePoints: 100,
  suspendedRunsPerInstallation: 20,
  qrPayloadChars: 128,
  requestBodyBytes: 16 * 1024,
} as const;

export const PROXIMITY = {
  defaultRadiusMeters: 40,
  minRadiusMeters: 15,
  maxRadiusMeters: 150,
  maxAccuracyMeters: 25,
  maxFixAgeSeconds: 15,
  maxFutureSkewSeconds: 5,
} as const;

export const RETENTION = {
  inactivityExpiryDays: 180,
} as const;
