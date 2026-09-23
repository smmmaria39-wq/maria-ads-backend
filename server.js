const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- FIREBASE ADMIN INITIALIZATION ---
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("ERROR: FIREBASE_SERVICE_ACCOUNT environment variable is missing!");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://maria-ad-default-rtdb.firebaseio.com"
});

const db = admin.database();
const app = express();

// --- CORS ---
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('Maria Ads Server is running!');
});

// ==========================================
// 1. AD SERVING ENDPOINT
// ==========================================
app.post('/api/getEligibleAd', async (req, res) => {
  const { placementId, pageUrl } = req.body;
  
  console.log(`[Maria Ads] Ad request received for placement: ${placementId}, pageUrl: ${pageUrl || 'N/A'}`);
  
  if (!placementId) {
    console.warn('[Maria Ads] Request missing placementId');
    return res.status(400).json({ error: "Placement ID is required" });
  }
  
  try {
    // 1. Verify placement exists and is active
    const placementSnap = await db.ref(`placements/${placementId}`).get();
    if (!placementSnap.exists()) {
      console.warn(`[Maria Ads] Placement not found: ${placementId}`);
      return res.status(200).json({ ad: null });
    }
    
    const placementData = placementSnap.val();
    if (placementData.status !== 'active') {
      console.warn(`[Maria Ads] Placement inactive: ${placementId} (Status: ${placementData.status})`);
      return res.status(200).json({ ad: null });
    }
    console.log(`[Maria Ads] Placement status: active`);
    
    // 2. Fetch all campaigns (which now contain the ad data directly)
    const campaignsSnap = await db.ref('campaigns').get();
    if (!campaignsSnap.exists()) {
      console.warn('[Maria Ads] No campaigns found in database.');
      return res.status(200).json({ ad: null });
    }
    
    const campaignsData = campaignsSnap.val();
    let eligibleAds = [];
    let activeAdsCount = 0;
    
    // 3. Filter for eligible campaigns (active and containing valid ad data)
    for (const id in campaignsData) {
      const camp = campaignsData[id];
      
      // Skip if campaign is missing critical fields or not active
      if (!camp || camp.status !== 'active' || !camp.destinationUrl) {
        continue;
      }
      
      activeAdsCount++;
      
      eligibleAds.push({
        adId: id,
        type: camp.adType || 'text', // Fallback to text if type missing
        title: camp.title || '',
        description: camp.description || '',
        imageUrl: camp.imageUrl || '',
        videoUrl: camp.videoUrl || '',
        destinationUrl: camp.destinationUrl,
        campaignId: id, // Campaign ID is the Ad ID in the new architecture
        clickToken: id,
        trackingToken: id
      });
    }
    
    console.log(`[Maria Ads] Total campaigns found: ${Object.keys(campaignsData).length}`);
    console.log(`[Maria Ads] Active campaigns with ad data found: ${eligibleAds.length}`);
    
    // 4. Select a random ad from eligible pool
    if (eligibleAds.length > 0) {
      const randomAd = eligibleAds[Math.floor(Math.random() * eligibleAds.length)];
      console.log(`[Maria Ads] Selected ad: ${randomAd.adId}`);
      return res.status(200).json({ ad: randomAd });
    } else {
      console.warn('[Maria Ads] No eligible ads found');
      return res.status(200).json({ ad: null });
    }
    
  } catch (error) {
    console.error("[Maria Ads] Ad Server Error:", error);
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
    // In the new architecture, the trackingToken IS the campaignId
    const campaignRef = db.ref(`campaigns/${trackingToken}`);
    const campSnap = await campaignRef.get();
    
    if (campSnap.exists()) {
      await campaignRef.transaction((currentData) => {
        if (currentData) {
          currentData.impressions = (currentData.impressions || 0) + 1;
        }
        return currentData;
      });
      console.log(`[Maria Ads] Impression recorded for campaign: ${trackingToken}`);
    }
    return res.status(200).send("Impression recorded");
  } catch (error) {
    console.error("[Maria Ads] Impression Error:", error);
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
    // In the new architecture, the clickToken IS the campaignId
    const campaignRef = db.ref(`campaigns/${clickToken}`);
    const campSnap = await campaignRef.get();
    
    if (campSnap.exists()) {
      await campaignRef.transaction((currentData) => {
        if (currentData) {
          currentData.clicks = (currentData.clicks || 0) + 1;
        }
        return currentData;
      });
      console.log(`[Maria Ads] Click recorded for campaign: ${clickToken}`);
    }
    return res.status(200).send("Click recorded");
  } catch (error) {
    console.error("[Maria Ads] Click Error:", error);
    return res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Maria Ads Server running on port ${PORT}`);
});
