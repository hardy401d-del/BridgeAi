const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const DEFAULT_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = "claude-sonnet-5";
const GEMINI_MODEL = "gemini-2.5-flash";

const path = require('path');

app.use(express.static(path.join(__dirname, 'Public')));

app.get('/api/status', (req, res) => {
  res.send('ARI backend en ligne.');
});

app.post('/api/find', async (req, res) => {
  const { appareil, langues, competences, disponibilite, pays, objectif, ciblage, apiKey, provider } = req.body || {};

  const effectiveProvider = (provider === 'gemini') ? 'gemini' : 'anthropic';
  const effectiveKey = (apiKey || '').trim() || (effectiveProvider === 'anthropic' ? DEFAULT_API_KEY : '');
  if (!effectiveKey) {
    return res.status(400).json({ error: `Aucune clé API ${effectiveProvider} fournie. Renseigne ta clé en haut de la page.` });
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
    const raw = await callModel(prompt, true, effectiveKey, effectiveProvider);

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

function buildDocumentPrompt(docType, profile, fields) {
  const profileBlock = `- Appareil : ${profile.appareil || "non précisé"}
- Langues : ${profile.langues || "non précisé"}
- Compétences déclarées : ${profile.competences || "non précisé"}
- Disponibilité : ${profile.disponibilite || "non précisée"}
- Pays : ${profile.pays || "non précisé"}`;

  const commonRules = "Ne mens jamais et n'invente aucune information (expérience, diplôme, chiffre) non fournie ci-dessus ou ci-dessous.";

  if (docType === 'traduction') {
    return `Tu es ARI, assistant de traduction et relecture juridique.
${fields.mode === 'relire'
  ? `Relis et corrige le texte suivant (grammaire, clarté, terminologie juridique), en gardant la langue ${fields.sourceLang || "d'origine"}. Explique brièvement les corrections importantes en fin de réponse.`
  : `Traduis fidèlement le texte suivant du ${fields.sourceLang || "français"} vers le ${fields.targetLang || "anglais"}, en conservant un registre juridique précis et professionnel.`}

Texte source :
${fields.sourceText || "(non fourni)"}

${commonRules}

FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown :
{ "draft": "le résultat final" }`;
  }

  if (docType === 'brief') {
    return `Tu es ARI, assistant de rédaction freelance.
PROFIL :
${profileBlock}

Brief du client (plateforme : ${fields.platform || "non précisée"}) :
${fields.briefText || "(non fourni)"}

Mission : rédige le contenu demandé par ce brief, en respectant précisément ses consignes (sujet, longueur, ton, contraintes).
${commonRules}

FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown :
{ "draft": "le contenu final prêt à livrer" }`;
  }

  if (docType === 'contrat') {
    return `Tu es ARI, assistant de rédaction juridique.
Rédige un contrat simple et clair en français, structuré en articles (Objet, Durée, Rémunération, Obligations des parties, Confidentialité si pertinent, Résiliation, Litiges).

Partie A : ${fields.partieA || "non précisé"}
Partie B : ${fields.partieB || "non précisé"}
Objet : ${fields.objet || "non précisé"}
Durée : ${fields.duree || "non précisé"}
Rémunération : ${fields.montant || "non précisé"}
${fields.conditions ? "Conditions particulières : " + fields.conditions : ""}

${commonRules}
Précise en fin de document que ce contrat est un modèle généré automatiquement et qu'il est recommandé de le faire relire avant signature.

FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown :
{ "draft": "le texte complet du contrat" }`;
  }

  if (docType === 'resume_juridique') {
    const niveauTexte = { court: "une fiche courte (l'essentiel en quelques points)", moyen: "un résumé structuré de longueur moyenne", detaille: "un résumé détaillé mais toujours clair" }[fields.niveau] || "un résumé structuré";
    return `Tu es ARI, assistant de vulgarisation juridique.
Vulgarise le texte de cours ci-dessous en ${niveauTexte}, avec un langage clair et accessible, sans perdre la rigueur juridique. Utilise des titres et des puces si utile.

Texte source :
${fields.texteSource || "(non fourni)"}

${commonRules}

FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown :
{ "draft": "le résumé complet" }`;
  }

  if (docType === 'humanisation') {
    const tonTexte = { professionnel: "professionnel", decontracte: "décontracté", academique: "académique" }[fields.ton] || "naturel";
    return `Tu es ARI, spécialiste de la relecture anti-IA ("humanisation" de texte).
Réécris le texte ci-dessous dans un style ${tonTexte} et naturel, en éliminant les tics typiques de l'écriture générée par IA : rythme trop régulier, transitions génériques répétées ("de plus", "il est important de noter", "en conclusion", "en somme"), symétries artificielles, ton trop lisse ou trop équilibré, surutilisation de tirets ou de listes.
Varie naturellement la longueur et la structure des phrases, comme le ferait une personne qui écrit spontanément.

RÈGLE ABSOLUE : ne change RIEN au sens, n'ajoute et n'invente aucune information, aucun fait, aucun chiffre qui ne soit pas déjà dans le texte source.

Texte source :
${fields.aiText || "(non fourni)"}

FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown :
{ "draft": "le texte réécrit" }`;
  }

  if (docType === 'cv') {
    return `Tu es ARI, assistant de rédaction de CV.
Construis le contenu d'un CV moderne à partir des informations ci-dessous.

Nom : ${fields.nom || "non précisé"}
Titre / poste visé : ${fields.titre || "non précisé"}
Expériences (fournies telles quelles) :
${fields.experience || "non précisé"}
Formation (fournie telle quelle) :
${fields.formation || "non précisé"}
Stages (fournis tels quels) :
${fields.stages || "aucun"}
Centres d'intérêt (fournis tels quels) :
${fields.loisirs || "aucun"}
PROFIL :
${profileBlock}

${commonRules}

FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown, au format exact suivant :
{ "draft": {"fullName":"...", "jobTitle":"...", "summary":"2-3 phrases de profil percutant", "skills":["...","..."], "languages":["...","..."], "hobbies":["...","..."], "experience":[{"period":"...","role":"...","org":"...","description":"..."}], "internships":[{"period":"...","role":"...","org":"...","description":"..."}], "education":[{"period":"...","degree":"...","school":"..."}]} }`;
  }

  // candidature (par défaut)
  return `Tu es ARI CREATE, le module de rédaction de candidatures de BridgeAI.

PROFIL DE LA PERSONNE (seules informations à utiliser, ne rien ajouter au-delà) :
${profileBlock}

OPPORTUNITÉ CIBLÉE :
- Titre : ${fields.title || "non précisé"}
- Plateforme : ${fields.platform || "non précisée"}
- Compétences demandées : ${fields.required_skills || "non précisé"}
- Rémunération : ${fields.pay || "non précisé"}
- URL source : ${fields.url || "non précisée"}

MISSION :
Rédige un message de candidature court et convaincant, en français (ou dans la langue la plus adaptée à la plateforme si tu le juges pertinent, en le précisant), prêt à être envoyé ou copié-collé sur ${fields.platform || "la plateforme"}.

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
}

app.post('/api/create', async (req, res) => {
  const { profile, opportunity, docType, fields, apiKey, provider } = req.body || {};

  const effectiveProvider = (provider === 'gemini') ? 'gemini' : 'anthropic';
  const effectiveKey = (apiKey || '').trim() || (effectiveProvider === 'anthropic' ? DEFAULT_API_KEY : '');
  if (!effectiveKey) {
    return res.status(400).json({ error: `Aucune clé API ${effectiveProvider} fournie. Renseigne ta clé en haut de la page.` });
  }

  const effectiveDocType = docType || 'candidature';
  const effectiveFields = fields || opportunity || {};

  if (!profile || (effectiveDocType === 'candidature' && !effectiveFields.title)) {
    return res.status(400).json({ error: "Profil ou informations manquantes." });
  }

  const prompt = buildDocumentPrompt(effectiveDocType, profile, effectiveFields);

  try {
    const raw = await callModel(prompt, false, effectiveKey, effectiveProvider);

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

async function callModel(prompt, useWebSearch, apiKey, provider) {
  if (provider === 'gemini') {
    return callGemini(prompt, useWebSearch, apiKey);
  }
  return callClaude(prompt, useWebSearch, apiKey);
}

async function callClaude(prompt, useWebSearch, apiKey) {
  const body = {
    model: ANTHROPIC_MODEL,
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
  return cleanJsonText(raw);
}

async function callGemini(prompt, useWebSearch, apiKey) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  if (useWebSearch) {
    body.tools = [{ google_search: {} }];
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error("Erreur API Gemini : " + errText);
  }

  const data = await response.json();
  const parts = (data.candidates || [])[0]?.content?.parts || [];
  let raw = parts.map(p => p.text || "").join("\n").trim();
  return cleanJsonText(raw);
}

function cleanJsonText(raw) {
  return raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ARI backend en écoute sur le port ${PORT}`));
