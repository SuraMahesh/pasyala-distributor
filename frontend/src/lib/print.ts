/** Print the page with a clean title (shown by some browsers and used as the PDF file name). */
export function quickPrint(title: string) {
  const prev = document.title
  document.title = title
  const restore = () => {
    document.title = prev
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  window.print()
}
