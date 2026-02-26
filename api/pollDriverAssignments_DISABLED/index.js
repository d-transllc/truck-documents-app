module.exports = async function (context, myTimer) {
    context.log("✅ Timer function started.");
    context.log("⏰ Time: " + new Date().toISOString());
};
