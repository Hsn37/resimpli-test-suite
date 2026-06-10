export async function downloadRecording(url: string, callId: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch recording");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `${callId}.wav`;
    a.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}
