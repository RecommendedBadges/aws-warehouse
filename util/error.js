async function fatal(origin, err) {
    let errorMessage = `Error in ${origin}: ${err}\n`;
    process.stderr.write(errorMessage);
    process.exit(1);
}

export {
    fatal
};