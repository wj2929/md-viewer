import { formatAttachmentSql } from '../utils/localAttachmentSqlFormat'

self.onmessage = (event: MessageEvent<string>) => {
  self.postMessage(formatAttachmentSql(event.data))
}
