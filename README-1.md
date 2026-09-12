# ARI backend — déploiement depuis un téléphone

Tu n'as pas besoin d'un ordinateur pour ça. Tout se fait depuis le navigateur.

## 1. Récupérer une clé API Anthropic

- Va sur https://console.anthropic.com (ce n'est PAS la même chose qu'un compte claude.ai — il faut créer un compte développeur avec facturation activée)
- Crée une clé API (section "API Keys")
- Garde-la de côté, ne la partage jamais, ne la mets jamais dans le frontend

## 2. Mettre le code sur GitHub

- Crée un compte sur https://github.com si tu n'en as pas
- Crée un nouveau dépôt (repository) nommé `ari-backend`
- Utilise le bouton "Add file" → "Upload files" pour envoyer `server.js`, `package.json` et `.env.example`

## 3. Déployer sur Render (gratuit)

- Crée un compte sur https://render.com (tu peux te connecter avec GitHub)
- "New +" → "Web Service"
- Connecte ton dépôt `ari-backend`
- Render détecte Node automatiquement :
  - Build command : `npm install`
  - Start command : `npm start`
- Dans l'onglet "Environment", ajoute une variable :
  - `ANTHROPIC_API_KEY` = ta clé récupérée à l'étape 1
- Déploie. Tu obtiens une URL du type `https://ari-backend-xxxx.onrender.com`

## 4. Brancher le frontend

- Ouvre `ari_v0.html`
- Change la constante `BACKEND_URL` en haut du script par ton URL Render (suivie de `/api/find`)
- Réenregistre/réouvre le fichier

## À savoir

- Le plan gratuit de Render met le serveur en veille après inactivité : le premier appel après une pause peut prendre 20-30 secondes.
- Chaque recherche consomme des crédits sur ta clé API Anthropic (facturation à l'usage, séparée de ton abonnement claude.ai).
