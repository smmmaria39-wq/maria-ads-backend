const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- FIREBASE ADMIN INITIALIZATION ---
// We use Environment Variables on Railway for security
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
 credential: admin.credential.cert(serviceAccount),
 databaseURL: "https://maria-ad-default-rtdb.firebaseio.com" // Make sure this matches your DB URL
});

const db = admin.database();
const app = express();

// Middleware
app.use(cors()); // Allow requests from publisher websites
app.use(express.json()); // Parse JSON bodies

// ==========================================
// 1. AD SERVING ENDPOINT
// ==========================================
app.post('/api/getEligibleAd', async (req, res) => {
 const { placementId } = req.body;
 
 if (!placementId) {
  return res.status(400).json({ error: "Placement ID is required" });
 }
 
 try {
  // 1. Verify placement exists and is active
  const placementSnap = await db.ref(`placements/${placementId}`).get();
  if (!placementSnap.exists() || placementSnap.val().status !== 'active') {
   return res.status(200).json({ ad: null }); // Fail gracefully
  }
  
  // 2. Fetch all ads
  const adsSnap = await db.ref('ads').get();
  if (!adsSnap.exists()) {
   return res.status(200).json({ ad: null });
  }
  
  const ads = adsSnap.val();
  let eligibleAds = [];
  
  // 3. Filter for eligible ads (active and belonging to active campaigns)
  for (const id in ads) {
   const ad = ads[id];
   if (ad.status === 'active') {
    const campSnap = await db.ref(`campaigns/${ad.campaignId}`).get();
    if (campSnap.exists() && campSnap.val().status === 'active') {
     eligibleAds.push({
      adId: id,
      type: ad.type,
      title: ad.title,
      description: ad.description,
      imageUrl: ad.imageUrl,
      videoUrl: ad.videoUrl,
      destinationUrl: ad.destinationUrl,
      campaignId: ad.campaignId,
      clickToken: id,
      trackingToken: id
     });
    }
   }
  }
  
  // 4. Select a random ad from eligible pool
  if (eligibleAds.length > 0) {
   const randomAd = eligibleAds[Math.floor(Math.random() * eligibleAds.length)];
   return res.status(200).json({ ad: randomAd });
  } else {
   return res.status(200).json({ ad: null });
  }
  
 } catch (error) {
  console.error("Ad Server Error:", error);
  return res.status(500).json({ error: "Internal Server Error" });
 }
});

// ==========================================
// 2. IMPRESSION TRACKING ENDPOINT
// ==========================================
app.post('/api/recordImpression', async (req, res) => {
 const { trackingToken } = req.body;
 
 if (!trackingToken) return res.status(400).send("Token required");
 
 try {
  const adRef = db.ref(`ads/${trackingToken}`);
  const adSnap = await adRef.get();
  
  if (adSnap.exists()) {
   // Increment ad impressions securely
   await adRef.transaction((currentData) => {
    if (currentData) {
     currentData.impressions = (currentData.impressions || 0) + 1;
    }
    return currentData;
   });
   
   // Increment campaign impressions
   const campaignId = adSnap.val().campaignId;
   if (campaignId) {
    await db.ref(`campaigns/${campaignId}`).transaction((currentData) => {
     if (currentData) {
      currentData.impressions = (currentData.impressions || 0) + 1;
     }
     return currentData;
    });
   }
  }
  return res.status(200).send("Impression recorded");
 } catch (error) {
  console.error("Impression Error:", error);
  return res.status(500).send("Internal Server Error");
 }
});

// ==========================================
// 3. CLICK TRACKING ENDPOINT
// ==========================================
app.post('/api/recordClick', async (req, res) => {
 const { clickToken } = req.body;
 
 if (!clickToken) return res.status(400).send("Token required");
 
 try {
  const adRef = db.ref(`ads/${clickToken}`);
  const adSnap = await adRef.get();
  
  if (adSnap.exists()) {
   // Increment ad clicks securely
   await adRef.transaction((currentData) => {
    if (currentData) {
     currentData.clicks = (currentData.clicks || 0) + 1;
    }
    return currentData;
   });
   
   // Increment campaign clicks
   const campaignId = adSnap.val().campaignId;
   if (campaignId) {
    await db.ref(`campaigns/${campaignId}`).transaction((currentData) => {
     if (currentData) {
      currentData.clicks = (currentData.clicks || 0) + 1;
     }
     return currentData;
    });
   }
  }
  return res.status(200).send("Click recorded");
 } catch (error) {
  console.error("Click Error:", error);
  return res.status(500).send("Internal Server Error");
 }
});

// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
 console.log(`Maria Ads Server running on port ${PORT}`);
});