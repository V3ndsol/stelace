/**
* ListingXTag.js
*
* @description :: TODO: You might write a short summary of how this model works and what it represents here.
* @docs        :: http://sailsjs.org/#!documentation/models
*/

module.exports = {

    attributes: {
        listingId: {
            type: "integer",
            index: true
        },
        tagId: {
            type: "integer",
            index: true
        }
    }

};
