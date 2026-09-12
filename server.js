const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const DEFAULT_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-5";

const path = require('path');

app.use(express.static(path.join(__dirname, 'Public')));

app.get('/api/status', (req, res) => {
  res.send('ARI backend en ligne.');
});

app.post('/api/find', async (req, res) => {
  const { appareil, langues, competences, disponibilite, pays, objectif, ciblage, apiKey } = req.body || {};

  const effectiveKey = (apiKey || '').trim() || DEFAULT_API_KEY;
  if (!effectiveKey) {
    return res.status(400).json({ error: "Aucune clé API fournie. Renseigne ta clé Anthropic en haut de la page, ou configure ANTHROPIC_API_KEY sur le serveur." });
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
    const raw = await callClaude(prompt, true, effectiveKey);

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

app.post('/api/create', async (req, res) => {
  const { profile, opportunity, apiKey } = req.body || {};

  const effectiveKey = (apiKey || '').trim() || DEFAULT_API_KEY;
  if (!effectiveKey) {
    return res.status(400).json({ error: "Aucune clé API fournie. Renseigne ta clé Anthropic en haut de la page, ou configure ANTHROPIC_API_KEY sur le serveur." });
  }
  if (!profile || !opportunity || !opportunity.title) {
    return res.status(400).json({ error: "Profil ou opportunité manquant." });
  }

  const prompt = `Tu es ARI CREATE, le module de rédaction de candidatures de BridgeAI.

PROFIL DE LA PERSONNE (seules informations à utiliser, ne rien ajouter au-delà) :
- Appareil : ${profile.appareil || "non précisé"}
- Langues : ${profile.langues || "non précisé"}
- Compétences déclarées : ${profile.competences || "non précisé"}
- Disponibilité : ${profile.disponibilite || "non précisée"}
- Pays : ${profile.pays || "non précisé"}

OPPORTUNITÉ CIBLÉE :
- Titre : ${opportunity.title}
- Plateforme : ${opportunity.platform || "non précisée"}
- Compétences demandées : ${opportunity.required_skills || "non précisé"}
- Rémunération : ${opportunity.pay || "non précisé"}
- URL source : ${opportunity.url || "non précisée"}

MISSION :
Rédige un message de candidature court et convaincant, en français (ou dans la langue la plus adaptée à la plateforme si tu le juges pertinent, en le précisant), prêt à être envoyé ou copié-collé sur ${opportunity.platform || "la plateforme"}.

RÈGLES STRICTES (ne jamais les enfreindre) :
- N'invente AUCUNE expérience, diplôme, réalisation, portfolio ou année d'expérience qui ne figure pas dans le profil fourni ci-dessus.
- Ne mens jamais sur les compétences : ne prétends pas maîtriser quelque chose d'absent du profil, même si l'opportunité le demande. Si un écart existe entre les compétences demandées et le profil, tu peux le mentionner honnêtement de façon positive (volonté d'apprendre) plutôt que de l'inventer.
- Reste concis (150 à 250 mots), professionnel mais chaleureux, orienté sur ce que la personne peut apporter concrètement.
- N'ajoute pas de coordonnées bancaires, numéro de téléphone ou adresse qui n'ont pas été fournis.

FORMAT DE RÉPONSE :
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown :

{
  "draft": "le texte complet de la candidature, prêt à copier"
}`;

  try {
    const raw = await callClaude(prompt, false, effectiveKey);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: "Réponse d'ARI illisible, réessaie.", raw });
    }

    if (!parsed.draft) {
      return res.status(502).json({ error: "Format de réponse inattendu." });
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function callClaude(prompt, useWebSearch, apiKey) {
  const body = {
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }]
  };
  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error("Erreur API Anthropic : " + errText);
  }

  const data = await response.json();
  const textBlocks = (data.content || []).filter(b => b.type === "text").map(b => b.text);
  let raw = textBlocks.join("\n").trim();
  raw = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return raw;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ARI backend en écoute sur le port ${PORT}`));
