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
  normalizedTables: z.array(GeminiNormalizedTableSchema),
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
