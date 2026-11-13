import { findAttachmentMatch, type AttachmentSearchRequest } from '../utils/attachmentSearch'

self.onmessage = (event: MessageEvent<AttachmentSearchRequest>) => {
  self.postMessage(findAttachmentMatch(event.data))
}
