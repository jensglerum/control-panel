# Automatic model selection

In a new chat, turn on **Auto model** below the message field. As you type, it chooses a model
from the current account's available catalog and shows its choice before you send. The
preference is saved in this browser. Choosing a model manually takes priority for that chat;
turn Auto model back on to resume automatic selection.

Auto also sets a supported reasoning level. Focused tasks use low effort when the model offers
it; other tasks use the chosen model's own default. This avoids carrying a previous model's
high effort into a simple task. Choosing a reasoning level yourself takes priority for that chat.

Focused text tasks such as summarizing or translating prefer Luna or Haiku. General coding and
unclear requests prefer Sol or Sonnet. Architecture, security audits, migrations and long prompts
prefer Astra or Opus. These are local prompt rules, not a measured guarantee of quality or cost.
The router makes no extra AI request.

To request Fable with Auto, start with **Use Fable 5.2** or **Fable 5.2:** while using a Claude
account that offers it. Generic complex tasks continue to prefer Opus. A requested Fable version
must be available in that account; Auto does not substitute an older version or Mythos. If it is
unavailable, the current selection stays in place, so check the model shown before sending.

If the matching family is unavailable, the selected model stays in place. Attached context,
slash commands, multiple-model runs and existing conversations also keep their selected model.
Auto model does not change accounts or provider permissions. Use
**Analytics** to inspect reported usage and **Accounts** to add accounts or check allowance.
