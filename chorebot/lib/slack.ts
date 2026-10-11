export async function notifySlack(webhookUrl: string, text: string) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }),
    });
  } catch (error) {
    console.error("Error sending Slack notification:", error);
  }
}
