require("dotenv").config();
const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");

/*
 * Operator-run, IDEMPOTENT: folds the old four-field certificate template into
 * the simplified single-document shape.
 *
 *   backgroundImageUrl -> documentTemplateUrl (the artwork carries on as the
 *                         whole certificate document)
 *   signatureImageUrl / signatoryName / signatoryTitle -> removed. The client's
 *   spec is that signatures live INSIDE the uploaded document.
 *
 * Run with: npm run migrate:certificate-template-simplify
 * NOT wired into runDevelopmentMigrations. A second run finds nothing: only
 * documents still carrying an old field are touched.
 */
async function migrateCertificateTemplateSimplify() {
  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    await mongoose.connect(applicationConfig.databaseUri);
  }
  try {
    const collection = mongoose.connection.db.collection("fests");
    const staleFests = await collection
      .find({
        $or: [
          { "certificateTemplate.backgroundImageUrl": { $exists: true } },
          { "certificateTemplate.signatureImageUrl": { $exists: true } },
          { "certificateTemplate.signatoryName": { $exists: true } },
          { "certificateTemplate.signatoryTitle": { $exists: true } },
        ],
      })
      .toArray();

    let convertedCount = 0;
    for (const fest of staleFests) {
      const documentTemplateUrl =
        fest.certificateTemplate?.documentTemplateUrl ??
        fest.certificateTemplate?.backgroundImageUrl ??
        null;
      await collection.updateOne(
        { _id: fest._id },
        { $set: { certificateTemplate: { documentTemplateUrl } } }
      );
      convertedCount += 1;
    }
    console.log(`fests: simplified certificateTemplate on ${convertedCount} documents.`);
    return { convertedCount };
  } finally {
    if (ownsConnection) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  migrateCertificateTemplateSimplify()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrateCertificateTemplateSimplify };
