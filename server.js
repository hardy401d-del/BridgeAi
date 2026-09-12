const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-5";

app.get('/', (req, res) => {
  res.send('ARI backend en ligne.');
});

app.post('/api/find', async (req, res) => {
  const { appareil, langues, competences, disponibilite, pays, objectif, ciblage } = req.body || {};

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Clé API manquante côté serveur (variable ANTHROPIC_API_KEY non définie)." });
  }
  if (!competences || !langues) {
    return res.status(400).json({ error: "Profil incomplet." });
  }

  const ciblageTexte = (ciblage || '').trim();

  const prompt = `Tu es ARI FIND, le module de recherche d'opportunités de BridgeAI.

PROFIL UTILISATEUR :
- Appareil : ${appareil || "non précisé"}
- Langues : ${langues}
- Compétences : ${competences}
- Disponibilité : ${disponibilite || "non précisée"}
- Pays : ${pays || "non précisé"}
- Objectif financier : ${objectif || "non précisé"} EUR
${ciblageTexte ? `- Ciblage demandé explicitement par l'utilisateur : ${ciblageTexte}` : ""}

MISSION :
Utilise l'outil de recherche web pour trouver de VRAIES opportunités actuelles adaptées à ce profil, en couvrant DEUX types :
1. Freelance / missions ponctuelles : plateformes comme Upwork, Fiverr, ComeUp, Freelancer.com, ProZ, Malt.
2. Emploi salarié / remote à plus long terme : LinkedIn (offres publiques), Indeed, HelloWork, Welcome to the Jungle, ou équivalents pertinents pour la langue et le pays de l'utilisateur.

Fais plusieurs recherches ciblées (par compétence, et sur ces différentes plateformes/sites) avant de répondre. Mélange freelance et salarié dans le même tableau "opportunities" — ne privilégie pas un type par défaut, laisse le profil (disponibilité, compétences) guider la pertinence.

${ciblageTexte ? `CIBLAGE ADDITIONNEL DEMANDÉ :
En plus du tableau générique "opportunities" ci-dessus, l'utilisateur a explicitement demandé un ciblage : "${ciblageTexte}". Fais des recherches supplémentaires en conséquence (ex : entreprises plus établies, ayant un besoin réel et durable du type de compétence proposé, plutôt que des annonces génériques ou ponctuelles) et retourne CES résultats en plus, dans un tableau séparé "targeted_opportunities", avec le même format que "opportunities" plus un champ "targeting_reason" expliquant en une phrase pourquoi cette opportunité correspond au ciblage demandé. Ce tableau ciblé s'ajoute au tableau générique, il ne le remplace jamais.` : `Le tableau "targeted_opportunities" n'est pas nécessaire ici : l'utilisateur n'a pas demandé de ciblage explicite. Tu peux l'omettre ou le laisser vide.`}

RÈGLES STRICTES (ne jamais les enfreindre) :
- N'invente JAMAIS une opportunité, une plateforme ou une rémunération.
- Chaque opportunité doit provenir d'un résultat réel retourné par ta recherche, avec son URL exacte issue de ce résultat.
- Si une information n'est pas confirmée par les résultats de recherche (rémunération, pays acceptés, méthode de paiement, date de publication), écris exactement "non vérifié" pour ce champ — ne complète jamais par une estimation ou une supposition.
- N'affirme jamais qu'un moyen de paiement est disponible dans le pays donné sans l'avoir vu confirmé dans un résultat de recherche.
- Respecte les conditions d'utilisation de chaque plateforme : tu fais uniquement de la recherche d'information publique, jamais de scraping massif ni de simulation de compte.
- Si tu ne trouves aucune opportunité réelle correspondant au profil (ou au ciblage), renvoie une liste vide pour cette catégorie plutôt que d'inventer.

FORMAT DE RÉPONSE :
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown, respectant exactement ce schéma :

{
  "opportunities": [
    {
      "title": "string",
      "platform": "string, nom de la plateforme ou du site source",
      "url": "string, URL exacte de la source",
      "pay": "string ou 'non vérifié'",
      "required_skills": "string ou 'non vérifié'",
      "geo_restriction": "string ou 'non vérifié'",
      "payment_method": "string ou 'non vérifié'",
      "published_date": "string ou 'non vérifié'",
      "match_score": nombre entre 0 et 100
    }
  ],
  "targeted_opportunities": [
    {
      "title": "string",
      "platform": "string",
      "url": "string",
      "pay": "string ou 'non vérifié'",
      "required_skills": "string ou 'non vérifié'",
      "geo_restriction": "string ou 'non vérifié'",
      "payment_method": "string ou 'non vérifié'",
      "published_date": "string ou 'non vérifié'",
      "match_score": nombre entre 0 et 100,
      "targeting_reason": "string"
    }
  ]
}

Donne entre 3 et 8 opportunités dans "opportunities", classées par match_score décroissant. Si un ciblage a été demandé, donne entre 2 et 5 opportunités dans "targeted_opportunities". Sinon renvoie "targeted_opportunities": [].`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "Erreur API Anthropic : " + errText });
    }

    const data = await response.json();
    const textBlocks = (data.content || []).filter(b => b.type === "text").map(b => b.text);
    let raw = textBlocks.join("\n").trim();
    raw = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: "Réponse d'ARI illisible, réessaie.", raw });
    }

    if (!Array.isArray(parsed.opportunities)) {
      return res.status(502).json({ error: "Format de réponse inattendu." });
    }
    if (!Array.isArray(parsed.targeted_opportunities)) {
      parsed.targeted_opportunities = [];
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ARI backend en écoute sur le port ${PORT}`));
