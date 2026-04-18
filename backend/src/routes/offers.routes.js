
const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth.middleware");
const offersController = require("../controllers/offers.controller");

router.post("/", protect, offersController.createOffer);


router.get("/request/:requestId", protect, offersController.getOffersByRequest);

router.post("/:offerId/accept", protect, offersController.acceptOffer);


router.post("/:offerId/cancel", protect, offersController.cancelMyOffer);


router.get("/me", protect, offersController.getMyOffers);

module.exports = router;
