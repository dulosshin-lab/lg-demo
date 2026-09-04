/* PDF 한 장 → 글자 조각(좌표 포함). 브라우저 전용 — pdf.js 워커를 띄운다.

   값을 찾는 규칙은 resume.ts 에 있고 여기는 읽기만 한다. Node 단위 테스트는 이 파일을
   거치지 않고 pdfjs-dist 의 legacy 빌드로 같은 조각을 만들어 resume.ts 를 검증한다.

   워커는 **하나를 만들어 돌려쓴다.** 장마다 getDocument 에 맡기면 장마다 워커를 새로 띄우고
   destroy 가 그 워커를 죽여서, 467장에 74초가 걸렸다(장당 157ms). 워커를 넘겨주면
   로딩 태스크가 자기 것이 아니라 보고 destroy 때 살려 둔다. */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem } from './resume'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

let shared: pdfjs.PDFWorker | null = null
const workerOf = () => (shared ??= new pdfjs.PDFWorker())

/** 페이지 하나의 글자 조각. y 는 위에서 아래로 커지도록 뒤집어 준다 (pdf 좌표는 아래가 0) */
export async function textItemsOf(file: File, pageNo = 1): Promise<TextItem[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), worker: workerOf(), verbosity: 0 })
  try {
    const doc = await task.promise
    const page = await doc.getPage(Math.min(pageNo, doc.numPages))
    const height = page.getViewport({ scale: 1 }).height
    const content = await page.getTextContent()
    const out: TextItem[] = []
    for (const it of content.items) {
      if (!('str' in it)) continue
      out.push({ str: it.str, x: it.transform[4], y: height - it.transform[5], w: it.width, h: it.height })
    }
    return out
  } finally {
    await task.destroy()
  }
}
