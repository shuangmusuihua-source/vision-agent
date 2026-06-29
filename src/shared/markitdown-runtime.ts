export const MARKITDOWN_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx'] as const

export type MarkitdownFormat = typeof MARKITDOWN_FORMATS[number]

export type MarkitdownRuntimeStatus =
  | {
      state: 'ready'
      source: 'managed' | 'external'
      pythonPath: string
      pythonVersion: string
      markitdownVersion: string
      supportedFormats: MarkitdownFormat[]
    }
  | {
      state: 'installable'
      pythonPath: string
      pythonVersion: string
      missingFormats: MarkitdownFormat[]
    }
  | {
      state: 'python-missing'
      minimumPythonVersion: string
    }

export type MarkitdownRuntimeInstallResult =
  | { success: true; status: Extract<MarkitdownRuntimeStatus, { state: 'ready' }> }
  | { success: false; error: string }

