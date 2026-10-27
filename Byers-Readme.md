Storing a Database Directly Inside Your GitHub Repository
Because GitHub Pages is a static file host, browser JavaScript cannot run direct git commit and git push commands locally at runtime without authentication. However, we have implemented a GitHub Repository Database Provider (src/sync/githubRepoDb.js) that uses the GitHub REST Contents API to store, read, and commit your app database (piped-db.json) directly inside any GitHub repository of your choice.

How to use the GitHub Repository Database:
Open the app and go to Preferences (PreferencesPage.vue).
Scroll down to the Database in GitHub Repository section.
Enter your GitHub Personal Access Token (with repo scope).
Specify your Repository Owner (username or organization), Repository Name (e.g. piped-db), and Branch (e.g. main).
Click Sync to Repository to fetch, merge (Last-Write-Wins), and commit your subscriptions, watch history, playlists, and settings directly as piped-db.json inside your repository!