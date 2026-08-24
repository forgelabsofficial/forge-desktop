use keyring::Entry;

fn main() {
    println!("Testing keyring operations...");
    
    let service = "forge-desktop-test";
    let account = "test-account";
    let password = "test-password-123";
    
    // Clean up
    if let Ok(entry) = Entry::new(service, account) {
        let _ = entry.delete_credential();
        println!("Cleaned up any existing test credentials");
    }
    
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    // Create entry
    println!("Creating keyring entry...");
    let entry = match Entry::new(service, account) {
        Ok(e) => {
            println!("✓ Successfully created entry");
            e
        },
        Err(e) => {
            eprintln!("✗ Failed to create entry: {}", e);
            return;
        }
    };
    
    // Set password
    println!("Storing password...");
    match entry.set_password(password) {
        Ok(_) => println!("✓ Successfully stored password"),
        Err(e) => {
            eprintln!("✗ Failed to store password: {}", e);
            return;
        }
    }
    
    // Wait for persistence
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    // Get password
    println!("Retrieving password...");
    match entry.get_password() {
        Ok(retrieved) => {
            if retrieved == password {
                println!("✓ Successfully retrieved password (matches!)");
            } else {
                eprintln!("✗ Retrieved password doesn't match: got '{}', expected '{}'", retrieved, password);
            }
        },
        Err(e) => {
            eprintln!("✗ Failed to retrieve password: {}", e);
            return;
        }
    }
    
    // Delete
    println!("Deleting password...");
    match entry.delete_credential() {
        Ok(_) => println!("✓ Successfully deleted credential"),
        Err(e) => eprintln!("✗ Failed to delete credential: {}", e),
    }
    
    println!("\nAll keyring operations completed!");
}
