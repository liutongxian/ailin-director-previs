import { PREVIS_AGENT_INSTRUCTIONS, PREVIS_IR_SCHEMA, PREVIS_IR_TEMPLATE } from '../engine/previs-ir'

export interface ScriptModelConfig {
  baseUrl: string
  model: string
  apiKey?: string
}

export interface ScriptModelImage {
  assetId: string
  assetName: string
  kind: 'character' | 'scene' | 'prop'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  base64: string
}

export type ScriptModelResult = { ok: true; text: string } | { ok: false; error: string }

export function openAICompatibleEndpoint(input: string): string {
  const url = new URL(input.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API地址只支持 http 或 https。')
  const path = url.pathname.replace(/\/+$/u, '')
  if (/\/chat\/completions$/u.test(path)) return url.toString()
  url.pathname = `${path || ''}${path.endsWith('/v1') ? '' : '/v1'}/chat/completions`.replace(/\/+/gu, '/')
  return url.toString()
}

export function buildScriptModelUserContent(sourceText: string, images: readonly ScriptModelImage[]): string | Record<string, unknown>[] {
  if (images.length === 0) return sourceText
  const content: Record<string, unknown>[] = [{
    type: 'text',
    text: `${sourceText}\n\n以下是项目资产中心中已经上传的参考图。它们只用于匹配人物身份、场景标志物、道具类别和可见朝向；不要根据图片改写剧情，也不要把图片透视直接当作可靠米制坐标。`
  }]
  for (const image of images) {
    content.push({
      type: 'text',
      text: `参考资产：${image.assetName}（${image.assetId}，${image.kind}）`
    })
    content.push({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
    })
  }
  return content
}

export async function analyzeScriptWithModel(
  config: ScriptModelConfig,
  sourceText: string,
  images: readonly ScriptModelImage[] = [],
  externalSignal?: AbortSignal
): Promise<ScriptModelResult> {
  if (!sourceText.trim()) return { ok: false, error: '剧本或分镜内容为空。' }
  if (sourceText.length > 500_000) return { ok: false, error: '当前单次分析最多支持50万字符，请分集导入。' }
  if (!config.model.trim()) return { ok: false, error: '请填写模型名称。' }
  let endpoint: string
  try {
    endpoint = openAICompatibleEndpoint(config.baseUrl)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const controller = new AbortController()
  const cancelFromCaller = (): void => controller.abort()
  externalSignal?.addEventListener('abort', cancelFromCaller, { once: true })
  const timeout = setTimeout(() => controller.abort(), 180_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey?.trim() ? { authorization: `Bearer ${config.apiKey.trim()}` } : {})
      },
      body: JSON.stringify({
        model: config.model.trim(),
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `${PREVIS_AGENT_INSTRUCTIONS}\n\nJSON Schema:\n${JSON.stringify(PREVIS_IR_SCHEMA)}\n\n格式示例：\n${PREVIS_IR_TEMPLATE}`
          },
          { role: 'user', content: buildScriptModelUserContent(sourceText, images.slice(0, 8)) }
        ]
      }),
      signal: controller.signal
    })
    const raw = await response.text()
    if (!response.ok) return { ok: false, error: `大模型接口返回 ${response.status}：${raw.slice(0, 500)}` }
    const data = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content
    if (!content) return { ok: false, error: '大模型接口没有返回Previs IR内容。' }
    return { ok: true, text: content.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim() }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: externalSignal?.aborted ? '已取消大模型生成，请求连接已中止。' : '大模型分析超时，请检查接口或缩短输入。' }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', cancelFromCaller)
  }
}
