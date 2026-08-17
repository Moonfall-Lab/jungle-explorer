import { z } from 'zod';

export const positionSchema = z.object({
  row: z.number().int().min(0),
  col: z.number().int().min(0),
});

export const createGameSchema = z.object({
  seed: z.string().trim().min(1).max(80).optional(),
  persona: z.enum(['CAUTIOUS', 'DAREDEVIL', 'FORAGER', 'INSTINCT']).default('CAUTIOUS'),
  mode: z.enum(['standard', 'demo']).default('standard'),
});

export const playIntentSchema = z.object({
  card: z.enum(['CAUTIOUS', 'EXPLORE', 'VERIFY', 'FIND_CLUE']),
});

export const localizationSchema = z.object({
  roverId: z.string().min(1).default('rover-01'),
  position: positionSchema,
  heading: z.enum(['NORTH', 'EAST', 'SOUTH', 'WEST']).optional(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['APRILTAG', 'VIRTUAL_ROVER']),
  capturedAt: z.string().datetime(),
});

export const bioSignalSchema = z.object({
  heartRate: z.number().min(30).max(240),
  hrv: z.number().min(0).max(300).optional(),
  tension: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  capturedAt: z.string().datetime(),
});

export const roverResultSchema = z
  .object({
    planId: z.string().min(1),
    gameId: z.string().min(1),
    status: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
    sequence: z.string().min(1),
    position: positionSchema.optional(),
    heading: z.enum(['NORTH', 'EAST', 'SOUTH', 'WEST']).optional(),
    sdkTelemetry: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.status === 'COMPLETED' && !value.position) {
      context.addIssue({
        code: 'custom',
        path: ['position'],
        message: 'a completed rover result requires a final position',
      });
    }
  });

export const roverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('EXECUTE_PLAN'),
    gameId: z.string(),
    planId: z.string(),
    commands: z.array(
      z.object({
        action: z.enum(['FORWARD', 'TURN_LEFT', 'TURN_RIGHT']),
        cells: z.number().int().positive().optional(),
        degrees: z.literal(90).optional(),
      }),
    ),
  }),
  z.object({
    type: z.literal('MOVE_FINISHED'),
    gameId: z.string(),
    planId: z.string(),
    estimatedDistanceCm: z.number().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('EMERGENCY_STOP'), gameId: z.string() }),
]);

export type CreateGameInput = z.infer<typeof createGameSchema>;
export type PlayIntentInput = z.infer<typeof playIntentSchema>;
export type LocalizationInput = z.infer<typeof localizationSchema>;
export type BioSignalInput = z.infer<typeof bioSignalSchema>;
export type RoverResultInput = z.infer<typeof roverResultSchema>;
export type RoverMessage = z.infer<typeof roverMessageSchema>;
