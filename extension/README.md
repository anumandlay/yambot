# YamBot Chrome Extension

Load unpacked from this folder.

1. Pair with the website: paste API URL + JWT (Copy login token on Chats page).
2. Configure LLM on the **website Settings** page (preferred).
3. Extension polls `/api/extension/tasks/next` and runs the agent loop.
4. Results stream back into the website chat.
