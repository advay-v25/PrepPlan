export function PageLoading({ message }: { message: string }) {
  return <div className="page-content"><p className="muted" role="status">{message}</p></div>
}
