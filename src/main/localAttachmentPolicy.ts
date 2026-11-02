import {
  AUDIO_MIME_TYPES, VIDEO_MIME_TYPES, IMAGE_MIME_TYPES, DOCUMENT_EXTENSIONS,
  LOCAL_ATTACHMENT_TEXT_EXTENSIONS,
} from '../shared/localMedia'

const SYSTEM_TEXT_EXTENSIONS = new Set(['.json', '.txt', '.log', '.csv', '.yaml', '.yml'])
const SYSTEM_ATTACHMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ppt', '.pptx'])
const BINARY_ATTACHMENT_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.zip', '.gz', '.tgz', '.7z', '.tar', '.rar',
  '.sqlite', '.sqlite3', '.db', '.woff', '.woff2', '.ttf', '.otf',
])

export function canOpenAttachment(extension: string): boolean {
  return SYSTEM_TEXT_EXTENSIONS.has(extension) || SYSTEM_ATTACHMENT_EXTENSIONS.has(extension)
    || (extension !== '.svg' && Object.hasOwn(IMAGE_MIME_TYPES, extension))
    || Object.hasOwn(AUDIO_MIME_TYPES, extension) || Object.hasOwn(VIDEO_MIME_TYPES, extension)
}

export function canViewUnknownAttachmentAsText(extension: string): boolean {
  return !LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(extension) && !DOCUMENT_EXTENSIONS.has(extension)
    && !Object.hasOwn(IMAGE_MIME_TYPES, extension) && !Object.hasOwn(AUDIO_MIME_TYPES, extension)
    && !Object.hasOwn(VIDEO_MIME_TYPES, extension) && !BINARY_ATTACHMENT_EXTENSIONS.has(extension)
}
