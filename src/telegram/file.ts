interface TelegramFile {
  file_id: string
  file_path?: string
}

export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ buf: ArrayBuffer; filename: string }> {
  const meta = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  })
  if (!meta.ok) throw new Error(`getFile ${meta.status}`)
  const json = (await meta.json()) as { ok: boolean; result?: TelegramFile }
  const path = json.result?.file_path
  if (!path) throw new Error('no file_path in getFile response')
  const dl = await fetch(`https://api.telegram.org/file/bot${botToken}/${path}`)
  if (!dl.ok) throw new Error(`file download ${dl.status}`)
  const buf = await dl.arrayBuffer()
  const filename = path.split('/').pop() ?? 'audio.ogg'
  return { buf, filename }
}
