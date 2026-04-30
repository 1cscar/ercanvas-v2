import { z } from 'zod'

export const GeminiNormalizedFieldSchema = z.object({
  name: z.string(),
  isPK: z.boolean().optional(),
  isPrimaryKey: z.boolean().optional(),
  isFK: z.boolean().optional(),
  isForeignKey: z.boolean().optional(),
  refTable: z.union([z.string(), z.null()]).optional(),
  refField: z.union([z.string(), z.null()]).optional(),
  dataType: z.union([z.string(), z.null()]).optional(),
  nullable: z.union([z.boolean(), z.null()]).optional()
})

export const GeminiNormalizedTableSchema = z.object({
  name: z.string(),
  fields: z.array(GeminiNormalizedFieldSchema)
})

export const GeminiNormalizationResultSchema = z.object({
  domain: z.string().optional().default(''),
  inputAnalysis: z
    .object({
      entities: z
        .array(
          z.object({
            table: z.string(),
            columns: z.array(z.string()).optional().default([])
          })
        )
        .optional()
        .default([]),
      keys: z
        .array(
          z.object({
            table: z.string(),
            candidateKeys: z.array(z.array(z.string())).optional().default([]),
            primaryKey: z.array(z.string()).optional().default([]),
            foreignKeys: z
              .array(
                z.object({
                  column: z.string(),
                  refTable: z.string(),
                  refField: z.string()
                })
              )
              .optional()
              .default([])
          })
        )
        .optional()
        .default([]),
      businessAssumptions: z.array(z.string()).optional().default([])
    })
    .optional(),
  normalizationDiagnosis: z
    .array(
      z.object({
        normalForm: z.string(),
        table: z.string(),
        issue: z.string(),
        reason: z.string(),
        functionalDependency: z.union([z.string(), z.null()]).optional()
      })
    )
    .optional()
    .default([]),
  normalizedTables: z.array(GeminiNormalizedTableSchema),
  integrityNotes: z.array(z.string()).optional().default([]),
  notes: z.array(z.string()).optional().default([])
})

export const GeminiTranslateResponseSchema = z.object({
  tables: z
    .array(
      z.object({
        name: z.string().optional(),
        nameEn: z.string().optional(),
        fields: z
          .array(
            z.object({
              name: z.string().optional(),
              nameEn: z.string().optional()
            })
          )
          .optional()
      })
    )
    .optional()
})

export type GeminiNormalizationResultInput = z.input<typeof GeminiNormalizationResultSchema>
export type GeminiTranslateResponseInput = z.input<typeof GeminiTranslateResponseSchema>
